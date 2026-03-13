import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from auth import verify_access_token
from generation_service import (
    GenerationStartError,
    append_chat_history,
    start_generation_for_user,
    subscribe_websocket,
    unsubscribe_websocket,
    unsubscribe_websocket_from_all,
)
from project_store import get_project_for_user


class ClientDisconnectedError(Exception):
    """Raised when the websocket is closed and cannot accept outbound messages."""


def _is_send_after_close_error(error: Exception) -> bool:
    return isinstance(error, RuntimeError) and 'Cannot call "send" once a close message has been sent.' in str(error)


async def _safe_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
    except WebSocketDisconnect:
        return False
    except RuntimeError as error:
        if _is_send_after_close_error(error):
            return False
        raise
    return True


async def _safe_send_json(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    return await _safe_send_text(websocket, json.dumps(payload))


def _token_from_message(data: dict[str, Any]) -> str | None:
    token = data.get("access_token")
    if isinstance(token, str) and token.strip():
        return token

    fallback = data.get("auth_token")
    if isinstance(fallback, str) and fallback.strip():
        return fallback

    return None


def _project_id_from_message(data: dict[str, Any]) -> str | None:
    project_id = data.get("project_id")
    if isinstance(project_id, str) and project_id.strip():
        return project_id.strip()
    return None


async def _send_project_ready(websocket: WebSocket, project_id: str, share_slug: str | None) -> bool:
    return await _safe_send_json(
        websocket,
        {
            "type": "project_ready",
            "project_id": project_id,
            "share_slug": share_slug,
        },
    )


async def _send_generation_snapshot(websocket: WebSocket, row: dict[str, Any]) -> bool:
    return await _safe_send_json(
        websocket,
        {
            "type": "generation_snapshot",
            "project_id": row.get("id"),
            "generation_status": row.get("generation_status"),
            "generation_stage": row.get("generation_stage"),
            "generation_error": row.get("generation_error"),
            "generation_trace_id": row.get("generation_trace_id"),
            "generation_started_at": row.get("generation_started_at"),
            "generation_completed_at": row.get("generation_completed_at"),
            "last_event_at": row.get("last_event_at"),
        },
    )


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Main WebSocket handler. Routes messages by type.

    Accepted message types:
      - start_generation:  { type, answers, access_token|auth_token, project_id? }
      - subscribe_project: { type, project_id, access_token|auth_token }
      - chat:              { type, message, access_token|auth_token, project_id? }
      - canvas_edit:       { type, action, access_token|auth_token, project_id?, ... }

    Emitted message types:
      - project_ready:      { type, project_id, share_slug }
      - generation_started: { type, project_id, trace_id, generation_status }
      - generation_snapshot:{ type, project_id, generation_* }
      - pipeline_event:     { type, project_id, trace_id, stage, event, level, message, ts, details? }
      - status:             { type, project_id, trace_id, message }
      - agent_log:          { type, project_id, trace_id, agent, message, elapsed }
      - diagram_event:      { type, project_id, trace_id, action, ... }
      - terraform_file:     { type, project_id, trace_id, filename, content, description }
      - cost_estimate:      { type, project_id, trace_id, data }
      - arch_description:   { type, project_id, trace_id, sections }
      - done:               { type, project_id, trace_id }
      - chat_reply:         { type, message }
      - error:              { type, error, message }
    """

    subscribed_projects: set[str] = set()

    while True:
        try:
            raw = await websocket.receive_text()
        except WebSocketDisconnect:
            break
        except Exception:
            break

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            if not await _safe_send_json(websocket, {"type": "error", "error": "invalid_json"}):
                break
            continue

        msg_type = data.get("type")
        user_id: str | None = None

        if msg_type in {"start_generation", "subscribe_project", "chat", "canvas_edit"}:
            token = _token_from_message(data)
            if token is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "unauthenticated",
                        "message": "Missing access token. Please sign in again.",
                    },
                ):
                    break
                continue

            user_id = verify_access_token(token)
            if user_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_token",
                        "message": "Session expired or invalid. Please sign in again.",
                    },
                ):
                    break
                continue

        if msg_type == "start_generation":
            answers = data.get("answers", {})
            project_id = _project_id_from_message(data)

            try:
                result = await start_generation_for_user(user_id or "", answers, project_id)
            except GenerationStartError as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": error.code,
                        "message": error.message,
                    },
                ):
                    break
                continue
            except Exception as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "generation_start_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

            started_project_id = str(result["project_id"])
            if result.get("created_project"):
                if not await _send_project_ready(
                    websocket,
                    started_project_id,
                    result.get("share_slug") if isinstance(result.get("share_slug"), str) else None,
                ):
                    break

            await subscribe_websocket(started_project_id, websocket)
            subscribed_projects.add(started_project_id)

            if not await _safe_send_json(
                websocket,
                {
                    "type": "generation_started",
                    "project_id": started_project_id,
                    "trace_id": result.get("trace_id"),
                    "generation_status": result.get("generation_status"),
                },
            ):
                break

        elif msg_type == "subscribe_project":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_project_id",
                        "message": "Missing project_id for subscription.",
                    },
                ):
                    break
                continue

            try:
                row = get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            await subscribe_websocket(project_id, websocket)
            subscribed_projects.add(project_id)

            if not await _send_generation_snapshot(websocket, row):
                break

        elif msg_type == "chat":
            project_id = _project_id_from_message(data)
            chat_text = data.get("message")

            if project_id and isinstance(chat_text, str):
                try:
                    append_chat_history(project_id, user_id or "", "user", chat_text)
                except Exception:
                    pass

            reply = {
                "type": "chat_reply",
                "message": "Chat modifications coming soon. Use 'Generate Architecture' to start.",
            }
            if not await _safe_send_json(websocket, reply):
                break

            if project_id and isinstance(chat_text, str):
                try:
                    append_chat_history(project_id, user_id or "", "assistant", reply["message"])
                except Exception:
                    pass

        elif msg_type == "canvas_edit":
            if not await _safe_send_json(websocket, {"type": "done"}):
                break

        else:
            if not await _safe_send_json(
                websocket,
                {"type": "error", "error": f"unknown message type: {msg_type}"},
            ):
                break

    for project_id in list(subscribed_projects):
        await unsubscribe_websocket(project_id, websocket)
    await unsubscribe_websocket_from_all(websocket)
