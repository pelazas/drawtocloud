import json
import asyncio
import logging
import time
from contextlib import suppress
from typing import Any

from llm_client import async_stream_text
from agents.log_helper import emit_log

logger = logging.getLogger(__name__)
ARCHITECT_KEEPALIVE_INTERVAL_SECONDS = 10.0

ARCHITECT_SYSTEM = """You are an AWS architecture diagram generator for DrawToCloud.

Given a requirements JSON, output diagram events — one per line — describing a complete AWS architecture.

Each line must be a valid JSON object in one of these formats:
{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "aws_service_code": "AmazonVPC"}
{"action": "add_node", "id": "ecs", "label": "ECS Service", "category": "compute", "node_type": "service", "parent_id": "vpc", "aws_service_code": "AmazonECS", "instance_type": "t3.small"}
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
- add `aws_service_code` on every node
- add `instance_type` for instance-based services (EC2, ECS on EC2, RDS, ElastiCache)
- add `engine` for RDS/ElastiCache nodes when relevant (e.g. PostgreSQL, MySQL, Redis)
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
    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None
    await emit_log(websocket, "architect", "Designing architecture...", start_time, trace_id=trace_id)
    logger.info("architect.started trace_id=%s", trace_id)
    buffer = ""
    first_event_emitted = False
    first_node_emitted = False
    consecutive_bad_lines = 0
    node_count = 0
    edge_count = 0
    last_valid_line_at = time.monotonic()
    stall_warned = False
    stream_started_at = time.monotonic()
    keepalive_stop = asyncio.Event()

    async def emit_keepalives() -> None:
        while not keepalive_stop.is_set():
            try:
                await asyncio.wait_for(keepalive_stop.wait(), timeout=ARCHITECT_KEEPALIVE_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                logger.info(
                    "architect.keepalive_sent trace_id=%s idle_seconds=%d",
                    trace_id,
                    int(time.monotonic() - stream_started_at),
                )
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "pipeline_event",
                            "stage": "architect",
                            "event": "still_streaming",
                            "message": "Architect is still generating the first diagram events.",
                            "trace_id": trace_id,
                        }
                    )
                )

    keepalive_task = asyncio.create_task(emit_keepalives())
    logger.info(
        "architect.keepalive_started trace_id=%s interval_seconds=%s",
        trace_id,
        ARCHITECT_KEEPALIVE_INTERVAL_SECONDS,
    )
    try:
        async for chunk in async_stream_text(
            messages=[{"role": "user", "content": json.dumps(requirements)}],
            system=ARCHITECT_SYSTEM,
            llm_creds=llm_creds,
            log_context={"agent": "architect", "trace_id": trace_id},
        ):
            if first_node_emitted:
                now = time.monotonic()
                if now - last_valid_line_at > 10 and not stall_warned:
                    stall_warned = True
                    logger.warning("architect.stall_warning trace_id=%s idle_seconds=%d", trace_id, int(now - last_valid_line_at))
            buffer += chunk
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    if not first_event_emitted:
                        keepalive_stop.set()
                        first_event_emitted = True
                        logger.info(
                            "architect.first_event trace_id=%s latency_ms=%d action=%s",
                            trace_id,
                            int((time.monotonic() - stream_started_at) * 1000),
                            event.get("action"),
                        )
                    await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                    last_valid_line_at = time.monotonic()
                    stall_warned = False
                    if event.get("action") == "add_node":
                        first_node_emitted = True
                        consecutive_bad_lines = 0
                        node_count += 1
                        await emit_log(
                            websocket, "architect",
                            f"Added {event['label']} ({event.get('category', '')})",
                            start_time,
                            trace_id=trace_id,
                        )
                    elif event.get("action") == "add_edge":
                        edge_count += 1
                        source = event.get("from")
                        target = event.get("to")
                        await emit_log(
                            websocket,
                            "architect",
                            f"Connected {source} -> {target}",
                            start_time,
                            trace_id=trace_id,
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
    finally:
        keepalive_stop.set()
        keepalive_task.cancel()
        with suppress(asyncio.CancelledError):
            await keepalive_task
        logger.info("architect.keepalive_stopped trace_id=%s first_event=%s", trace_id, first_event_emitted)
    await emit_log(
        websocket,
        "architect",
        f"Architecture complete ({node_count} nodes, {edge_count} edges)",
        start_time,
        trace_id=trace_id,
        details={"nodes": node_count, "edges": edge_count},
    )
    logger.info("architect.completed trace_id=%s nodes=%d edges=%d", trace_id, node_count, edge_count)
