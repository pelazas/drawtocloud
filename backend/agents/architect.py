import json
import asyncio
from llm_client import async_stream_text
from agents.log_helper import emit_log

ARCHITECT_SYSTEM = """You are an AWS architecture diagram generator for DrawToCloud.

Given a requirements JSON, output diagram events — one per line — describing a complete AWS architecture.

Each line must be a valid JSON object in one of these formats:
{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container"}
{"action": "add_node", "id": "ecs", "label": "ECS Service", "category": "compute", "node_type": "service", "parent_id": "vpc"}
{"action": "add_edge", "from": "alb", "to": "ecs", "label": "routes to"}

Node categories: network | compute | database | storage | security | monitoring

Rules:
- Output nodes in dependency order: network → compute → data → monitoring
- VPC is always first. Use node_type "container" on VPC only.
- All AWS services inside VPC: add "parent_id":"vpc" and "node_type":"service".
- Services outside VPC (CloudWatch, Route53, S3 if external): omit parent_id.
- Always emit VPC before any node that references it as parent.
- End with CloudWatch.
- Add edges immediately after the nodes they connect — never batch edges at the end
- IDs: lowercase_with_underscores, unique (e.g. "ecs_cluster", "rds_primary")
- Labels: short and readable ("RDS PostgreSQL" not "Amazon Relational Database Service")
- For multi-AZ: create separate nodes (e.g. "ecs_az1", "ecs_az2")
- Output ONLY event lines. No headers, no prose, no JSON arrays, no explanation."""


async def stream_architecture(requirements: dict, websocket, start_time: float = 0) -> None:
    await emit_log(websocket, "architect", "Designing architecture...", start_time)
    buffer = ""
    async for chunk in async_stream_text(
        messages=[{"role": "user", "content": json.dumps(requirements)}],
        system=ARCHITECT_SYSTEM,
    ):
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                if event.get("action") == "add_node":
                    await emit_log(
                        websocket, "architect",
                        f"Added {event['label']} ({event.get('category', '')})",
                        start_time,
                    )
                await asyncio.sleep(0.3)
            except json.JSONDecodeError:
                pass  # silently skip prose/preamble lines
    await emit_log(websocket, "architect", "Architecture complete", start_time)
