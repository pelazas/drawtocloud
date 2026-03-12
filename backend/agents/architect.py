import json
import asyncio
from llm_client import async_stream_text

ARCHITECT_SYSTEM = """You are an AWS architecture diagram generator for DrawToCloud.

Given a requirements JSON, output diagram events — one per line — describing a complete AWS architecture.

Each line must be a valid JSON object in one of these formats:
{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}
{"action": "add_edge", "from": "alb", "to": "ecs", "label": "routes to"}

Node categories: network | compute | database | storage | security | monitoring

Rules:
- Output nodes in dependency order: network → compute → data → monitoring
- Start with VPC. End with CloudWatch.
- Add edges immediately after the nodes they connect — never batch edges at the end
- IDs: lowercase_with_underscores, unique (e.g. "ecs_cluster", "rds_primary")
- Labels: short and readable ("RDS PostgreSQL" not "Amazon Relational Database Service")
- For multi-AZ: create separate nodes (e.g. "ecs_az1", "ecs_az2")
- Output ONLY event lines. No headers, no prose, no JSON arrays, no explanation."""


async def stream_architecture(requirements: dict, websocket) -> None:
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
                await asyncio.sleep(0.3)
            except json.JSONDecodeError:
                pass  # silently skip prose/preamble lines
