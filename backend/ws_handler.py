import asyncio
import json
from fastapi import WebSocket

FAKE_EVENTS = [
    {"type": "diagram_event", "action": "add_node", "id": "vpc",  "label": "VPC",              "category": "network"},
    {"type": "diagram_event", "action": "add_node", "id": "alb",  "label": "Load Balancer",     "category": "compute"},
    {"type": "diagram_event", "action": "add_node", "id": "ecs",  "label": "ECS Service",       "category": "compute"},
    {"type": "diagram_event", "action": "add_edge", "from": "alb", "to": "ecs", "label": "routes to"},
    {"type": "diagram_event", "action": "add_node", "id": "rds",  "label": "RDS PostgreSQL",    "category": "database"},
    {"type": "diagram_event", "action": "add_edge", "from": "ecs", "to": "rds", "label": "reads/writes"},
    {
        "type": "chat_reply",
        "message": (
            "I've designed a basic web architecture: a VPC containing an Application Load Balancer "
            "routing to an ECS service, which connects to an RDS PostgreSQL database."
        ),
    },
    {"type": "done"},
]


async def stream_fake_events(ws: WebSocket):
    for event in FAKE_EVENTS:
        await ws.send_text(json.dumps(event))
        await asyncio.sleep(0.4)


async def handle_websocket(ws: WebSocket):
    while True:
        try:
            raw = await ws.receive_text()
        except Exception:
            break

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send_text(json.dumps({"type": "error", "error": "invalid_json"}))
            continue

        msg_type = data.get("type")

        if msg_type == "chat":
            await stream_fake_events(ws)
        elif msg_type == "canvas_edit":
            # Stub — full Terraform regeneration in TICKET-003
            await ws.send_text(json.dumps({"type": "done"}))
        else:
            await ws.send_text(
                json.dumps({"type": "error", "error": f"unknown message type: {msg_type}"})
            )
