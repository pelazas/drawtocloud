import json
import logging
import re
from typing import Any
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from auth import verify_access_token_user
from agents.chat_agent import extract_mutation_constraints, is_mutation_intent, stream_chat_reply
from agents.discovery_agent import detect_plan_ready, stream_discovery_reply
from agents.mutation_agent import run_mutation_agent
from agents.mutation_apply import GraphMutationApplyError, apply_graph_mutation
from generation_service import (
    GenerationStartError,
    append_chat_history,
    rerun_project_agents_for_user,
    start_generation_for_user,
    subscribe_websocket,
    unsubscribe_websocket,
    unsubscribe_websocket_from_all,
)
from llm_keys import LlmKeyDecryptError, get_user_llm_key

logger = logging.getLogger(__name__)
from project_store import create_project_for_generation, get_project_for_user, update_project_fields


class ClientDisconnectedError(Exception):
    """Raised when the websocket is closed and cannot accept outbound messages."""


def _is_send_after_close_error(error: Exception) -> bool:
    return isinstance(error, RuntimeError) and 'Cannot call "send" once a close message has been sent.' in str(error)


async def _safe_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
    except (WebSocketDisconnect, ConnectionResetError, BrokenPipeError):
        logger.warning("ws.send_failed reason=disconnected")
        return False
    except RuntimeError as error:
        if _is_send_after_close_error(error):
            logger.warning("ws.send_failed reason=closed_socket")
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


def _normalize_regions(data: dict[str, Any]) -> list[str]:
    """Accept regions list, or wrap legacy region string."""
    regions = data.get("regions")
    if isinstance(regions, list):
        normalized = [entry.strip() for entry in regions if isinstance(entry, str) and entry.strip()]
        if normalized:
            return normalized

    region = data.get("region")
    if isinstance(region, str) and region.strip():
        return [region.strip()]

    return ["us-east-1"]


def _normalize_generation_answers(raw_answers: Any) -> dict[str, Any]:
    if not isinstance(raw_answers, dict):
        answers: dict[str, Any] = {}
    else:
        answers = dict(raw_answers)
    answers["regions"] = _normalize_regions(answers)
    answers.pop("region", None)
    return answers


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
            "project_mode": row.get("project_mode"),
            "generation_status": row.get("generation_status"),
            "generation_stage": row.get("generation_stage"),
            "generation_error": row.get("generation_error"),
            "generation_trace_id": row.get("generation_trace_id"),
            "generation_started_at": row.get("generation_started_at"),
            "generation_completed_at": row.get("generation_completed_at"),
            "last_event_at": row.get("last_event_at"),
            "setup_pdf_status": row.get("setup_pdf_status"),
            "setup_pdf_progress": row.get("setup_pdf_progress"),
            "setup_pdf_error": row.get("setup_pdf_error"),
            "setup_pdf_generated_at": row.get("setup_pdf_generated_at"),
            "setup_pdf_source_revision": row.get("setup_pdf_source_revision"),
        },
    )


def _apply_canvas_edit(
    action: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    data: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
    """Apply a canvas edit mutation in-memory.

    Returns (updated_nodes, updated_edges) on success, or None if action is unknown.
    """
    if action == "remove_node":
        node_id = data.get("id")
        updated_nodes = [n for n in nodes if n.get("id") != node_id]
        updated_edges = [
            e for e in edges
            if e.get("source") != node_id and e.get("target") != node_id
        ]
        return updated_nodes, updated_edges

    if action == "add_node":
        label = str(data.get("label", "node"))
        category = str(data.get("category", "compute"))
        node_id = f"{label.lower().replace(' ', '_')}_{uuid4().hex[:6]}"
        new_node: dict[str, Any] = {
            "id": node_id,
            "type": "default",
            "data": {"label": label, "category": category},
        }
        return [*nodes, new_node], list(edges)

    if action == "rename_node":
        node_id = data.get("id")
        new_label = data.get("label", "")
        updated_nodes = [
            {**n, "data": {**n.get("data", {}), "label": new_label}}
            if n.get("id") == node_id
            else n
            for n in nodes
        ]
        return updated_nodes, list(edges)

    return None


def _format_mutation_failure_message(error: Exception) -> str:
    message = str(error).strip()
    if not message:
        message = "The requested mutation could not be applied safely."
    return (
        "I couldn't apply that change safely. "
        f"{message} "
        "Try a narrower instruction (for example, target one selected node and desired outcome)."
    )


def _mutation_scope(selected_node_ids: list[str]) -> str:
    return "selected" if selected_node_ids else "all"


def _build_mutation_reply_message(
    assistant_message: str,
    summary: dict[str, Any],
    reasoning: str,
) -> str:
    message = assistant_message.strip()
    if message:
        return message

    parts = []
    nodes_added = int(summary.get("nodes_added", 0))
    nodes_edited = int(summary.get("nodes_edited", 0))
    nodes_deleted = int(summary.get("nodes_deleted", 0))
    edges_added = int(summary.get("edges_added", 0))
    edges_edited = int(summary.get("edges_edited", 0))
    edges_deleted = int(summary.get("edges_deleted", 0))
    if nodes_added:
        parts.append(f"added {nodes_added} node(s)")
    if nodes_edited:
        parts.append(f"edited {nodes_edited} node(s)")
    if nodes_deleted:
        parts.append(f"deleted {nodes_deleted} node(s)")
    if edges_added:
        parts.append(f"added {edges_added} edge(s)")
    if edges_edited:
        parts.append(f"edited {edges_edited} edge(s)")
    if edges_deleted:
        parts.append(f"removed {edges_deleted} edge(s)")
    if not parts:
        return "No graph changes were needed."
    why = reasoning.strip()
    if why:
        return f"I {', '.join(parts)}. {why}"
    return f"I {', '.join(parts)}."


def _is_plan_only_request(message: str) -> bool:
    normalized = message.lower()
    return any(
        phrase in normalized
        for phrase in (
            "provide a plan",
            "give me a plan",
            "show me a plan",
            "plan to",
        )
    )


def _is_architecture_wide_request(message: str) -> bool:
    normalized = message.lower()
    if any(
        phrase in normalized
        for phrase in (
            "whole architecture",
            "entire architecture",
            "overall architecture",
            "redo architecture",
            "re-do architecture",
            "rebuild architecture",
            "re-architect",
            "rearchitect",
            "architecture to be cheaper",
            "architecture cheaper",
            "more simple",
            "simpler architecture",
            "change the architecture",
            "redesign",
            "refactor the architecture",
            "without secrets manager",
            "remove secrets manager",
        )
    ):
        return True

    if "architecture" in normalized and re.search(r"\b(redo|re-do|redesign|refactor|re-architect|rearchitect|replace)\b", normalized):
        return True

    # Common refactor phrasing that doesn't include the word "architecture".
    if re.search(r"\breplace\b.+\bwith\b", normalized):
        return True

    return False


def _contains_explicit_insecure_secrets_request(message: str) -> bool:
    normalized = message.lower()
    return any(
        phrase in normalized
        for phrase in (
            "store secrets in ec2",
            "secrets on ec2",
            "without secrets manager",
            "remove secrets manager",
            "no secrets manager",
        )
    )


def _classify_execution_mode(message: str, selected_node_ids: list[str]) -> str:
    del selected_node_ids
    if _is_plan_only_request(message):
        return "plan_only"
    if _is_architecture_wide_request(message):
        return "architecture_refactor"
    if is_mutation_intent(message):
        return "node_patch"
    return "chat_only"


def _build_architecture_plan_message(user_message: str, include_security_warning: bool) -> str:
    warning = ""
    if include_security_warning:
        warning = (
            "Security warning: this request reduces secret-management protections. "
            "I will apply it as requested, but IAM roles + KMS-managed encryption remain the safer default.\n\n"
        )
    return (
        f"{warning}"
        "Proposed architecture refactor plan:\n"
        f"1. Apply your requested architecture change: {user_message.strip()}\n"
        "2. Re-run full pipeline (requirements -> architect -> coder + description)\n"
        "3. Stream updated diagram, Terraform, and description into this project\n"
        "4. Preserve chat history and continue iterative edits after regeneration\n\n"
        "Approve this plan to run it."
    )


def _find_pending_architecture_plan(
    history: list[dict[str, Any]],
    plan_id: str | None = None,
) -> dict[str, Any] | None:
    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue
        plan_meta = entry.get("plan_meta")
        if not isinstance(plan_meta, dict):
            continue
        if plan_meta.get("type") != "architecture_refactor":
            continue
        candidate_id = plan_meta.get("plan_id")
        if plan_id and candidate_id != plan_id:
            continue
        status = plan_meta.get("status")
        if status in {"approved", "executed", "rejected", "cancelled"}:
            return None
        if status == "pending":
            return plan_meta
    return None


def _build_full_rerun_answers(
    project_row: dict[str, Any],
    user_message: str,
    prior_history: list[dict[str, Any]],
) -> dict[str, Any]:
    base_answers = project_row.get("questionnaire_answers")
    answers = _normalize_generation_answers(base_answers)
    history_lines: list[str] = []
    for entry in prior_history[-10:]:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            history_lines.append(f"{role}: {content.strip()}")
    history_lines.append(f"user: {user_message.strip()}")
    answers["conversation_summary"] = "\n".join(history_lines)
    answers["_approved_plan"] = True
    return answers


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Main WebSocket handler. Routes messages by type.

    Accepted message types:
      - start_generation:     { type, answers, access_token|auth_token, project_id? }
      - subscribe_project:    { type, project_id, access_token|auth_token }
      - chat:                 { type, message, access_token|auth_token, project_id?, selected_node_ids? }
      - canvas_edit:          { type, action, access_token|auth_token, project_id?, ... }
      - chat_plan_approve:    { type, project_id, plan_id, access_token|auth_token }
      - chat_discovery_start: { type, app_name, regions, expected_users, uptime, compliance?, environment?, compute_preference?, monthly_budget?, access_token|auth_token, project_id? }

    Emitted message types:
      - project_ready:      { type, project_id, share_slug }
      - generation_started: { type, project_id, trace_id, generation_status }
      - generation_snapshot:{ type, project_id, generation_* }
      - canvas_edit_ack:   { type, project_id, action }
      - pipeline_event:     { type, project_id, trace_id, stage, event, level, message, ts, details? }
      - status:             { type, project_id, trace_id, message }
      - agent_log:          { type, project_id, trace_id, agent, message, elapsed, duration_ms, details? }
      - diagram_event:      { type, project_id, trace_id, action, ... }
      - terraform_file:     { type, project_id, trace_id, filename, content, description }
      - arch_description:   { type, project_id, trace_id, sections }
      - setup_pdf_status:  { type, project_id, setup_pdf_status, setup_pdf_progress, setup_pdf_error?, setup_pdf_generated_at?, setup_pdf_source_revision? }
      - done:               { type, project_id, trace_id }
      - chat_reply_delta:   { type, project_id, delta }
      - chat_reply_done:    { type, project_id, message, mutation?, execution_mode?, plan_ready?, plan_meta? }
      - error:              { type, error, message }
    """

    subscribed_projects: set[str] = set()
    client_host = getattr(getattr(websocket, "client", None), "host", "unknown")
    client_port = getattr(getattr(websocket, "client", None), "port", "unknown")
    logger.info("ws.connected client=%s:%s", client_host, client_port)

    while True:
        try:
            raw = await websocket.receive_text()
        except WebSocketDisconnect:
            logger.info("ws.disconnected client=%s:%s reason=websocket_disconnect", client_host, client_port)
            break
        except Exception as exc:
            logger.warning("WebSocket receive_text failed unexpectedly: %s", exc)
            break

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            if not await _safe_send_json(websocket, {"type": "error", "error": "invalid_json"}):
                break
            continue

        msg_type = data.get("type")
        logger.info("ws.message_received type=%s client=%s:%s", msg_type, client_host, client_port)
        user_id: str | None = None
        user_email: str | None = None

        if msg_type in {
            "start_generation",
            "subscribe_project",
            "chat",
            "canvas_edit",
            "chat_discovery_start",
            "chat_plan_approve",
        }:
            token = _token_from_message(data)
            if token is None:
                logger.warning("ws.auth_failed reason=missing_token type=%s", msg_type)
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

            auth_user = await verify_access_token_user(token)
            if auth_user is None:
                logger.warning("ws.auth_failed reason=invalid_token type=%s", msg_type)
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
            user_id = auth_user.user_id
            user_email = auth_user.email
            logger.info("ws.auth_ok user_id=%s type=%s", user_id, msg_type)

        if msg_type == "start_generation":
            answers = _normalize_generation_answers(data.get("answers", {}))
            project_id = _project_id_from_message(data)

            try:
                result = await start_generation_for_user(user_id or "", user_email or "", answers, project_id)
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
                row = await get_project_for_user(project_id, user_id or "")
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
            raw_selected_node_ids = data.get("selected_node_ids")
            selected_node_ids = (
                [entry.strip() for entry in raw_selected_node_ids if isinstance(entry, str) and entry.strip()]
                if isinstance(raw_selected_node_ids, list)
                else []
            )

            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for chat.",
                    },
                ):
                    break
                continue

            if not isinstance(chat_text, str) or not chat_text.strip():
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_chat_message",
                        "message": "Chat message must be a non-empty string.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
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

            llm_creds = None
            if user_id:
                try:
                    llm_creds = await get_user_llm_key(user_id)
                except LlmKeyDecryptError as error:
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "error": "llm_key_decrypt_failed",
                            "message": str(error),
                        },
                    ):
                        break
                    continue
                except Exception:
                    llm_creds = None

            generation_stage = project_row.get("generation_stage")
            project_mode = project_row.get("project_mode")
            questionnaire_answers = project_row.get("questionnaire_answers")
            if not isinstance(questionnaire_answers, dict):
                questionnaire_answers = {}

            is_discovery_mode = generation_stage == "discovery" or (
                project_mode == "discovery" and generation_stage != "completed"
            )
            if generation_stage != "completed" and not is_discovery_mode:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "chat_not_ready",
                        "message": "Chat is only available after generation completes.",
                    },
                ):
                    break
                continue

            user_message = chat_text.strip()
            prior_history = project_row.get("chat_history") if isinstance(project_row.get("chat_history"), list) else []

            try:
                await append_chat_history(project_id, user_id or "", "user", user_message)
            except Exception:
                pass

            assistant_chunks: list[str] = []
            plan_ready_flag = False
            plan_meta: dict[str, Any] | None = None
            execution_mode = "chat_only"
            mutation_intent = False
            try:
                if is_discovery_mode:
                    async for chunk, is_plan_sentinel in stream_discovery_reply(
                        user_message,
                        prior_history,
                        questionnaire_answers,
                        llm_creds=llm_creds,
                        trace_id=(
                            project_row.get("generation_trace_id")
                            if isinstance(project_row.get("generation_trace_id"), str)
                            else None
                        ),
                    ):
                        if is_plan_sentinel:
                            plan_ready_flag = True
                            continue
                        if chunk:
                            assistant_chunks.append(chunk)
                            if not await _safe_send_json(
                                websocket,
                                {
                                    "type": "chat_reply_delta",
                                    "project_id": project_id,
                                    "delta": chunk,
                                },
                            ):
                                break
                else:
                    execution_mode = _classify_execution_mode(user_message, selected_node_ids)
                    mutation_intent = execution_mode == "node_patch"

                    if execution_mode == "architecture_refactor":
                        plan_ready_flag = True
                        plan_id = str(uuid4())
                        include_warning = _contains_explicit_insecure_secrets_request(user_message)
                        assistant_message = _build_architecture_plan_message(
                            user_message,
                            include_security_warning=include_warning,
                        )
                        plan_meta = {
                            "plan_id": plan_id,
                            "type": "architecture_refactor",
                            "status": "pending",
                            "requested_change": user_message,
                        }

                        if not await _safe_send_json(
                            websocket,
                            {
                                "type": "chat_reply_done",
                                "project_id": project_id,
                                "message": assistant_message,
                                "plan_ready": True,
                                "execution_mode": execution_mode,
                                "plan_meta": plan_meta,
                            },
                        ):
                            break
                        try:
                            await append_chat_history(
                                project_id,
                                user_id or "",
                                "assistant",
                                assistant_message,
                                metadata={
                                    "plan_ready": True,
                                    "execution_mode": execution_mode,
                                    "plan_meta": plan_meta,
                                },
                            )
                        except Exception:
                            pass
                        continue

                    if execution_mode == "node_patch":
                        mutation_constraints = extract_mutation_constraints(user_message, selected_node_ids)
                        mutation_plan = await run_mutation_agent(
                            user_goal=user_message,
                            project_state=project_row,
                            selected_node_ids=selected_node_ids,
                            history=prior_history,
                            llm_creds=llm_creds,
                            user_constraints=mutation_constraints,
                        )
                        applied = apply_graph_mutation(
                            nodes=list(project_row.get("nodes") or []),
                            edges=list(project_row.get("edges") or []),
                            diff=mutation_plan.diff,
                            selected_node_ids=selected_node_ids,
                        )

                        await update_project_fields(
                            project_id,
                            user_id or "",
                            {
                                "nodes": applied["nodes"],
                                "edges": applied["edges"],
                                **(
                                    {"setup_pdf_status": "outdated"}
                                    if project_row.get("setup_pdf_status") in {"ready", "outdated"}
                                    else {}
                                ),
                            },
                        )

                        assistant_message = _build_mutation_reply_message(
                            assistant_message=mutation_plan.assistant_message,
                            summary=applied["summary"],
                            reasoning=mutation_plan.reasoning,
                        )
                        if _contains_explicit_insecure_secrets_request(user_message):
                            assistant_message = (
                                "Security warning: this change may weaken secret handling. "
                                "I applied the request as asked; consider IAM roles + KMS as a safer default.\n\n"
                                f"{assistant_message}"
                            )
                        rerun_agents = ["coder", "description"]
                        rerun_result = await rerun_project_agents_for_user(
                            user_id=user_id or "",
                            user_email=user_email or "",
                            project_id=project_id,
                            agent_names=rerun_agents,
                            user_message=user_message,
                        )
                        rerun_trace = rerun_result.get("trace_id")
                        rerun_suffix = f" (trace {rerun_trace})" if isinstance(rerun_trace, str) and rerun_trace else ""
                        assistant_message = (
                            f"{assistant_message}\n\n"
                            f"I’m re-running {', '.join(rerun_agents)} to refresh generated outputs{rerun_suffix}."
                        )
                        reply_payload = {
                            "type": "chat_reply_done",
                            "project_id": project_id,
                            "message": assistant_message,
                            "execution_mode": execution_mode,
                            "mutation": {
                                "diff": applied["normalized_diff"],
                                "summary": applied["summary"],
                                "scope": _mutation_scope(selected_node_ids),
                            },
                        }
                        if not await _safe_send_json(websocket, reply_payload):
                            break

                        try:
                            await append_chat_history(
                                project_id,
                                user_id or "",
                                "assistant",
                                assistant_message,
                                metadata={"execution_mode": execution_mode},
                            )
                        except Exception:
                            pass
                        continue

                    async for chunk in stream_chat_reply(
                        user_message,
                        prior_history,
                        project_row,
                        llm_creds=llm_creds,
                        selected_node_ids=selected_node_ids,
                    ):
                        assistant_chunks.append(chunk)
                        if not await _safe_send_json(
                            websocket,
                            {
                                "type": "chat_reply_delta",
                                "project_id": project_id,
                                "delta": chunk,
                            },
                        ):
                            break

                raw_message = "".join(assistant_chunks)
                if is_discovery_mode and plan_ready_flag:
                    assistant_message, _ = detect_plan_ready(raw_message)
                else:
                    assistant_message = raw_message.strip()

                if not assistant_message:
                    assistant_message = "I could not generate a response from the current context."

                reply_payload: dict[str, Any] = {
                    "type": "chat_reply_done",
                    "project_id": project_id,
                    "message": assistant_message,
                }
                if not is_discovery_mode:
                    reply_payload["execution_mode"] = execution_mode
                if plan_ready_flag:
                    reply_payload["plan_ready"] = True
                if plan_meta:
                    reply_payload["plan_meta"] = plan_meta

                if not await _safe_send_json(websocket, reply_payload):
                    break

                try:
                    assistant_metadata: dict[str, Any] = {}
                    if not is_discovery_mode:
                        assistant_metadata["execution_mode"] = execution_mode
                    if plan_ready_flag:
                        assistant_metadata["plan_ready"] = True
                    if plan_meta:
                        assistant_metadata["plan_meta"] = plan_meta
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "assistant",
                        assistant_message,
                        metadata=assistant_metadata or None,
                    )
                except Exception:
                    pass
            except GraphMutationApplyError as error:
                assistant_message = _format_mutation_failure_message(error)
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                    },
                ):
                    break
                try:
                    await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                except Exception:
                    pass
            except RuntimeError as error:
                if mutation_intent:
                    assistant_message = _format_mutation_failure_message(error)
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "chat_reply_done",
                            "project_id": project_id,
                            "message": assistant_message,
                            "execution_mode": execution_mode,
                        },
                    ):
                        break
                    try:
                        await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                    except Exception:
                        pass
                    continue
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "chat_failed",
                        "message": str(error),
                    },
                ):
                    break
            except Exception as error:
                if mutation_intent:
                    assistant_message = _format_mutation_failure_message(error)
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "chat_reply_done",
                            "project_id": project_id,
                            "message": assistant_message,
                            "execution_mode": execution_mode,
                        },
                    ):
                        break
                    try:
                        await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                    except Exception:
                        pass
                    continue
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "chat_failed",
                        "message": str(error),
                    },
                ):
                    break

        elif msg_type == "chat_plan_approve":
            project_id = _project_id_from_message(data)
            plan_id = data.get("plan_id")

            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for chat_plan_approve.",
                    },
                ):
                    break
                continue

            if not isinstance(plan_id, str) or not plan_id.strip():
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_plan_id",
                        "message": "plan_id is required for chat_plan_approve.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
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

            prior_history = project_row.get("chat_history") if isinstance(project_row.get("chat_history"), list) else []
            pending_plan = _find_pending_architecture_plan(prior_history, plan_id=plan_id.strip())
            if pending_plan is None:
                assistant_message = "I couldn't find an active architecture plan to approve. Please ask for a new plan first."
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": "architecture_refactor",
                    },
                ):
                    break
                try:
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "assistant",
                        assistant_message,
                        metadata={"execution_mode": "architecture_refactor"},
                    )
                except Exception:
                    pass
                continue

            requested_change = pending_plan.get("requested_change")
            approved_prompt = requested_change if isinstance(requested_change, str) and requested_change.strip() else "approved architecture refactor"
            rerun_answers = _build_full_rerun_answers(project_row, approved_prompt, prior_history)

            try:
                rerun_result = await start_generation_for_user(
                    user_id or "",
                    user_email or "",
                    rerun_answers,
                    project_id,
                )
                trace_id = rerun_result.get("trace_id")
                trace_suffix = f" (trace {trace_id})" if isinstance(trace_id, str) and trace_id else ""
                assistant_message = (
                    "Plan approved. I started a full pipeline rerun and will stream updated diagram, Terraform, cost, and description"
                    f"{trace_suffix}."
                )
                status = "approved"
            except GenerationStartError as error:
                assistant_message = (
                    "I couldn't start the approved architecture rerun yet. "
                    f"{error.message}"
                )
                status = "pending"

            approved_plan_meta = {
                "plan_id": pending_plan.get("plan_id"),
                "type": "architecture_refactor",
                "status": status,
                "requested_change": approved_prompt,
            }
            if not await _safe_send_json(
                websocket,
                {
                    "type": "chat_reply_done",
                    "project_id": project_id,
                    "message": assistant_message,
                    "execution_mode": "architecture_refactor",
                    "plan_meta": approved_plan_meta,
                },
            ):
                break
            try:
                await append_chat_history(
                    project_id,
                    user_id or "",
                    "assistant",
                    assistant_message,
                    metadata={
                        "execution_mode": "architecture_refactor",
                        "plan_meta": approved_plan_meta,
                    },
                )
            except Exception:
                pass

        elif msg_type == "canvas_edit":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for canvas_edit.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
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

            action = data.get("action", "")
            nodes: list[dict[str, Any]] = list(project_row.get("nodes") or [])
            edges: list[dict[str, Any]] = list(project_row.get("edges") or [])

            edit_result = _apply_canvas_edit(action, nodes, edges, data)
            if edit_result is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "unknown_canvas_action",
                        "message": f"Unknown canvas_edit action: {action!r}",
                    },
                ):
                    break
                continue

            updated_nodes, updated_edges = edit_result
            try:
                await update_project_fields(
                    project_id,
                    user_id or "",
                    {
                        "nodes": updated_nodes,
                        "edges": updated_edges,
                        **(
                            {"setup_pdf_status": "outdated"}
                            if project_row.get("setup_pdf_status") in {"ready", "outdated"}
                            else {}
                        ),
                    },
                )
            except Exception as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "canvas_edit_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

            if not await _safe_send_json(
                websocket,
                {
                    "type": "canvas_edit_ack",
                    "project_id": project_id,
                    "action": action,
                },
            ):
                break

        elif msg_type == "chat_discovery_start":
            discovery_answers: dict[str, Any] = {
                "app_name": str(data.get("app_name", "")),
                "regions": _normalize_regions(data),
                "expected_users": str(data.get("expected_users", "1K–100K/mo")),
                "uptime": str(data.get("uptime", "99.9% SLA")),
                "_mode": "chat_first",
            }
            for optional_key in ("compliance", "environment", "compute_preference"):
                val = data.get(optional_key)
                if isinstance(val, str) and val.strip():
                    discovery_answers[optional_key] = val.strip()
            monthly_budget = data.get("monthly_budget")
            if isinstance(monthly_budget, (int, float)) and monthly_budget >= 5:
                discovery_answers["monthly_budget"] = monthly_budget

            requested_project_id = _project_id_from_message(data)
            try:
                if requested_project_id:
                    try:
                        project_row = await get_project_for_user(requested_project_id, user_id or "")
                    except Exception:
                        project_row = await create_project_for_generation(user_id or "", discovery_answers)
                else:
                    project_row = await create_project_for_generation(user_id or "", discovery_answers)

                new_project_id = str(project_row.get("id", ""))
                if not new_project_id:
                    raise ValueError("Project creation returned no ID.")
                await update_project_fields(
                    new_project_id,
                    user_id or "",
                    {
                        "questionnaire_answers": discovery_answers,
                        "project_mode": "discovery",
                        "generation_status": "idle",
                        "generation_stage": "discovery",
                        "generation_error": None,
                    },
                )
            except Exception as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "discovery_start_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

            share_slug = project_row.get("share_slug") if isinstance(project_row.get("share_slug"), str) else None
            if not await _send_project_ready(websocket, new_project_id, share_slug):
                break

            await subscribe_websocket(new_project_id, websocket)
            subscribed_projects.add(new_project_id)

            opening_question = (
                "Let's design your AWS infrastructure. "
                "First: what does your application do and who are the main users?"
            )
            if not await _safe_send_json(
                websocket,
                {
                    "type": "chat_reply",
                    "project_id": new_project_id,
                    "message": opening_question,
                    "plan_ready": False,
                },
            ):
                break

            try:
                await append_chat_history(new_project_id, user_id or "", "assistant", opening_question)
            except Exception:
                pass

        else:
            if not await _safe_send_json(
                websocket,
                {"type": "error", "error": f"unknown message type: {msg_type}"},
            ):
                break

    for project_id in list(subscribed_projects):
        await unsubscribe_websocket(project_id, websocket)
    await unsubscribe_websocket_from_all(websocket)
    logger.info("ws.cleanup_complete client=%s:%s", client_host, client_port)
