import json
import asyncio
import logging
import time
from typing import Any, Callable

from llm_client import async_stream_text
from agents.log_helper import emit_log

logger = logging.getLogger(__name__)

ARCHITECT_SYSTEM = """You are an AWS architecture diagram generator for DrawToCloud.

Given a requirements JSON, output diagram events — one per line — describing a complete AWS architecture.

Each line must be a valid JSON object in one of these formats:
{"action": "add_node", "id": "us_east_1", "label": "US East 1", "category": "network", "node_type": "container", "container_type": "region"}
{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc", "parent_id": "us_east_1"}
{"action": "add_node", "id": "az_a", "label": "Availability Zone A", "category": "network", "node_type": "container", "container_type": "az", "parent_id": "vpc"}
{"action": "add_node", "id": "private_subnet_a", "label": "Private Subnet", "category": "network", "node_type": "container", "container_type": "subnet", "parent_id": "az_a"}
{"action": "add_node", "id": "ecs", "label": "ECS Service", "category": "compute", "node_type": "service", "parent_id": "private_subnet_a", "aws_service_code": "AmazonECS", "instance_type": "t3.small"}
{"action": "add_edge", "from": "alb", "to": "ecs", "label": "routes to"}

Node categories: network | compute | database | storage | security | monitoring

Rules:
- Output nodes in dependency order: network → compute → data → monitoring
- For multi-region architectures: emit one region container per region, then nest VPCs inside the region they belong to.
  Use parent order `region -> vpc -> az -> subnet -> services`. Region is root-level only.
  Use container_type "region" for region containers. Derive region node IDs from the AWS region code (e.g. "us_east_1", "eu_central_1").
  When `multi_region` is true or more than one region is requested, emit a region container for each region.
- For single-region architectures: region container is optional. You may start directly with VPC.
- VPC is always the first service-scoped container. Use node_type "container" and container_type "vpc" on VPC.
- Availability Zones and Subnets may also be emitted as containers when they clarify the architecture.
- For nested network structures (single region), use parent order `vpc -> az -> subnet -> services`.
- Use `container_type` only for container nodes: `region` | `vpc` | `az` | `subnet`.
- Services inside nested containers must use the deepest relevant parent_id (prefer subnet over az over vpc).
- Simple architectures may keep services directly under VPC when extra nesting does not add value.
- Services outside VPC (CloudWatch, Route53, S3 if external): omit parent_id.
- Always emit VPC before any node that references it as parent.
- Always emit a parent container before any child container or service that references it.
- End with CloudWatch.
- Add edges immediately after the nodes they connect — never batch edges at the end
- IDs: lowercase_with_underscores, unique (e.g. "ecs_cluster", "rds_primary")
- Labels: short and readable ("RDS PostgreSQL" not "Amazon Relational Database Service")
- For multi-AZ: create separate nodes (e.g. "ecs_az1", "ecs_az2")
- add `aws_service_code` for service nodes only; leave structural containers untagged so pricing does not treat them as billable resources
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
    emit_milestone: Callable[[str, str, str, bool, str | None], None] | None = None,
) -> None:
    def milestone(status: str, event_type: str, message: str, history: bool = False, error: str | None = None) -> None:
        if emit_milestone is not None:
            emit_milestone(status, event_type, message, history, error)

    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None
    await emit_log(websocket, "architect", "Designing architecture...", start_time, trace_id=trace_id)
    logger.info("architect.started trace_id=%s", trace_id)
    milestone("running", "started", "Starting architecture design", history=True)
    buffer = ""
    first_node_emitted = False
    consecutive_bad_lines = 0
    node_count = 0
    edge_count = 0
    last_valid_line_at = time.monotonic()
    stall_warned = False
    waiting_for_first = True
    network_started = False
    service_started = False
    connections_started = False

    async def process_line(line: str) -> None:
        nonlocal first_node_emitted, consecutive_bad_lines, node_count, edge_count, last_valid_line_at, stall_warned
        nonlocal waiting_for_first, network_started, service_started, connections_started
        line = line.strip()
        if not line:
            return
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("Architect event must be a JSON object")

            if event.get("action") == "add_node":
                if waiting_for_first:
                    waiting_for_first = False
                    milestone("running", "waiting_for_first_event", "Waiting for architecture output", history=False)
                    await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                    last_valid_line_at = time.monotonic()
                    node_count += 1
                    first_node_emitted = True
                    consecutive_bad_lines = 0
                    container_type = event.get("container_type")
                    if container_type in ("region", "vpc", "az", "subnet"):
                        if not network_started:
                            network_started = True
                            milestone("running", "network_layout_started", "Laying out networking components", history=True)
                    elif event.get("node_type") == "service":
                        if not service_started:
                            service_started = True
                            milestone("running", "service_layout_started", "Adding application services", history=True)
                    await emit_log(
                        websocket, "architect",
                        f"Added {event['label']} ({event.get('category', '')})",
                        start_time,
                        trace_id=trace_id,
                    )
                else:
                    await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                    last_valid_line_at = time.monotonic()
                    node_count += 1
                    consecutive_bad_lines = 0
                    container_type = event.get("container_type")
                    if container_type in ("region", "vpc", "az", "subnet"):
                        if not network_started:
                            network_started = True
                            milestone("running", "network_layout_started", "Laying out networking components", history=True)
                    elif event.get("node_type") == "service" and not service_started:
                        service_started = True
                        milestone("running", "service_layout_started", "Adding application services", history=True)
                    await emit_log(
                        websocket, "architect",
                        f"Added {event['label']} ({event.get('category', '')})",
                        start_time,
                        trace_id=trace_id,
                    )
            elif event.get("action") == "add_edge":
                if waiting_for_first:
                    waiting_for_first = False
                    milestone("running", "waiting_for_first_event", "Waiting for architecture output", history=False)
                await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                last_valid_line_at = time.monotonic()
                edge_count += 1
                stall_warned = False
                consecutive_bad_lines = 0
                if not connections_started:
                    connections_started = True
                    milestone("running", "connections_started", "Connecting AWS services", history=True)
                await emit_log(
                    websocket,
                    "architect",
                    f"Connected {event.get('from')} -> {event.get('to')}",
                    start_time,
                    trace_id=trace_id,
                )
            else:
                consecutive_bad_lines = 0
            await asyncio.sleep(0.3)
        except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
            if not first_node_emitted:
                return
            consecutive_bad_lines += 1
            logger.warning("Architect parse failure: consecutive_bad_lines=%d", consecutive_bad_lines)
            milestone("running", "parse_warning", "Skipping malformed architecture output", history=True)
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
                milestone("running", "stall_warning", "Architecture generation is taking longer than expected", history=True)
                logger.warning("architect.stall_warning trace_id=%s idle_seconds=%d", trace_id, int(now - last_valid_line_at))
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            await process_line(line)
    if buffer.strip():
        await process_line(buffer)
    if node_count == 0:
        raise RuntimeError("Architect agent produced no valid nodes.")
    await emit_log(
        websocket,
        "architect",
        f"Architecture complete ({node_count} nodes, {edge_count} edges)",
        start_time,
        trace_id=trace_id,
        details={"nodes": node_count, "edges": edge_count},
    )
    logger.info("architect.completed trace_id=%s nodes=%d edges=%d", trace_id, node_count, edge_count)
    milestone("completed", "completed", "Architecture ready", history=True)
