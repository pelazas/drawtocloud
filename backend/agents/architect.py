import json
import asyncio
import logging
from typing import Any

from llm_client import async_stream_text
from agents.log_helper import emit_log

logger = logging.getLogger(__name__)

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
- If `monthly_budget` or `budget_cap` is present, treat budget as a hard cap:
  - default to one region and one AZ unless requirements explicitly demand higher availability or residency
  - choose smallest viable compute/database/cache tiers
  - avoid expensive defaults (NAT Gateway, multi-AZ replicas, premium managed add-ons) unless explicitly required
  - minimize service count and redundancy while preserving required compliance/uptime constraints
- Output ONLY event lines. No headers, no prose, no JSON arrays, no explanation."""


async def stream_architecture(
    requirements: dict,
    websocket,
    start_time: float = 0,
    llm_creds: dict[str, Any] | None = None,
) -> None:
    await emit_log(websocket, "architect", "Designing architecture...", start_time)
    buffer = ""
    first_node_emitted = False
    consecutive_bad_lines = 0
    async for chunk in async_stream_text(
        messages=[{"role": "user", "content": json.dumps(requirements)}],
        system=ARCHITECT_SYSTEM,
        llm_creds=llm_creds,
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
                    first_node_emitted = True
                    consecutive_bad_lines = 0
                    await emit_log(
                        websocket, "architect",
                        f"Added {event['label']} ({event.get('category', '')})",
                        start_time,
                    )
                else:
                    consecutive_bad_lines = 0
                await asyncio.sleep(0.3)
            except json.JSONDecodeError:
                if not first_node_emitted:
                    pass  # silently skip prose/preamble lines before first node
                else:
                    consecutive_bad_lines += 1
                    logger.warning("Architect parse failure: consecutive_bad_lines=%d", consecutive_bad_lines)
                    await websocket.send_text(json.dumps({
                        "type": "pipeline_event",
                        "stage": "architect",
                        "event": "parse_warning",
                        "level": "warning",
                        "message": f"Skipped non-JSON line from architect (consecutive: {consecutive_bad_lines})",
                    }))
                    if consecutive_bad_lines >= 3:
                        raise RuntimeError(
                            f"Architect agent emitted {consecutive_bad_lines} consecutive non-JSON lines; aborting."
                        )
    await emit_log(websocket, "architect", "Architecture complete", start_time)
