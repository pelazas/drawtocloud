import json
import asyncio
from fastapi import WebSocket

from agents.requirements import generate_requirements
from agents.architect import stream_architecture
from agents.coder import stream_terraform_files
from agents.cost_analyst import run_cost_analyst


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Main WebSocket handler. Routes messages by type.

    Accepted message types:
      - start_generation: { type, answers }  → runs Requirements + Architect + Coder + Cost Analyst agents
      - chat:             { type, message }   → stub reply (TICKET-005)
      - canvas_edit:      { type, action, ... } → stub done (TICKET-005)

    Emitted message types:
      - status:        { type, message }
      - diagram_event: { type, action, ... }
      - terraform_file: { type, filename, content, description }
      - cost_estimate:  { type, data: { monthly_total, currency, line_items, generated_by } }
      - cost_status:    { type, message }
      - chat_reply:    { type, message }
      - done:          { type }
      - error:         { type, error, message }
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

        if msg_type == "start_generation":
            answers = data.get("answers", {})
            try:
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Analyzing your requirements...",
                }))
                requirements = await generate_requirements(answers)

                await websocket.send_text(json.dumps({
                    "type": "status",
                    "message": "Designing architecture and generating Terraform...",
                }))

                # All three agents run in parallel
                await asyncio.gather(
                    stream_architecture(requirements, websocket),
                    stream_terraform_files(requirements, websocket),
                    run_cost_analyst(requirements, websocket),
                )

                await websocket.send_text(json.dumps({"type": "done"}))

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
