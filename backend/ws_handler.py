import json
import asyncio
import time
import logging
from fastapi import WebSocket
from auth import verify_access_token
from quota import get_user_quota, increment_generations_used

from agents.requirements import generate_requirements
from agents.architect import stream_architecture
from agents.coder import stream_terraform_files
from agents.cost_analyst import run_cost_analyst
from agents.description import run_description_agent
from agents.log_helper import emit_log

logger = logging.getLogger(__name__)


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Main WebSocket handler. Routes messages by type.

    Accepted message types:
      - start_generation: { type, answers, access_token }  → runs Requirements + Architect + Coder + Cost Analyst + Description agents
      - chat:             { type, message, access_token }   → stub reply (TICKET-005)
      - canvas_edit:      { type, action, access_token, ... } → stub done (TICKET-005)

    Emitted message types:
      - status:           { type, message }
      - agent_log:        { type, agent, message, elapsed }
      - diagram_event:    { type, action, ... }
      - terraform_file:   { type, filename, content, description }
      - cost_estimate:    { type, data: { monthly_total, currency, line_items, generated_by } }
      - cost_status:      { type, message }
      - arch_description: { type, sections: { overview, key_components, tradeoffs, next_steps } }
      - chat_reply:       { type, message }
      - done:             { type }
      - error:            { type, error, message }
    """
    while True:
        try:
            raw = await websocket.receive_text()
        except Exception:
            break

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_text(json.dumps({"type": "error", "error": "invalid_json"}))
            continue

        msg_type = data.get("type")
        user_id: str | None = None

        if msg_type in {"start_generation", "chat", "canvas_edit"}:
            access_token = data.get("access_token")
            if not isinstance(access_token, str) or not access_token.strip():
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "unauthenticated",
                    "message": "Missing access token. Please sign in again.",
                }))
                continue

            user_id = verify_access_token(access_token)
            if user_id is None:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "invalid_token",
                    "message": "Session expired or invalid. Please sign in again.",
                }))
                continue

        if msg_type == "start_generation":
            answers = data.get("answers", {})
            try:
                quota = get_user_quota(user_id or "")
            except Exception:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "quota_check_failed",
                    "message": "Unable to check generation quota. Please try again.",
                }))
                continue

            if quota["generations_used"] >= quota["generations_limit"]:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "quota_exhausted",
                    "message": "You've used all 5 free generations...",
                }))
                continue

            try:
                start_time = time.time()
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Analyzing your requirements...",
                }))
                await emit_log(websocket, "requirements", "Processing questionnaire answers...", start_time)
                requirements = await generate_requirements(answers)
                await emit_log(websocket, "requirements", "Requirements extracted", start_time)

                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Designing architecture and generating Terraform...",
                }))

                # All agents run in parallel
                await asyncio.gather(
                    stream_architecture(requirements, websocket, start_time),
                    stream_terraform_files(requirements, websocket, start_time),
                    run_cost_analyst(requirements, websocket, start_time),
                    run_description_agent(requirements, websocket, start_time),
                )

                await websocket.send_text(json.dumps({"type": "done"}))
                try:
                    increment_generations_used(user_id or "")
                except Exception:
                    logger.exception("Failed to increment generations_used for user %s", user_id)

            except Exception as e:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "pipeline_failed",
                    "message": str(e),
                }))

        elif msg_type == "chat":
            await websocket.send_text(json.dumps({
                "type": "chat_reply",
                "message": "Chat modifications coming soon. Use 'Generate Architecture' to start.",
            }))

        elif msg_type == "canvas_edit":
            await websocket.send_text(json.dumps({"type": "done"}))

        else:
            await websocket.send_text(json.dumps({
                "type": "error",
                "error": f"unknown message type: {msg_type}",
            }))
