import json
import asyncio
import logging
import time
from collections import deque
from typing import Any, Callable

from llm_client import async_stream_text
from agents.log_helper import emit_log

logger = logging.getLogger(__name__)

VALID_CATEGORIES = frozenset({"network", "compute", "database", "storage", "security", "monitoring"})
VALID_CONTAINER_TYPES = frozenset({"region", "vpc", "az", "subnet"})
VALID_NODE_TYPES = frozenset({"container", "service"})
VALID_ACTIONS = frozenset({"add_node", "add_edge"})


class ArchitectOutputError(RuntimeError):
    """Raised when architect produces invalid or unparseable output."""

    def __init__(
        self,
        message: str,
        raw_preview: str = "",
        parse_failure_count: int = 0,
        validation_failure_count: int = 0,
        first_failure_reason: str = "",
        first_invalid_preview: str = "",
    ):
        super().__init__(message)
        self.raw_preview = raw_preview
        self.parse_failure_count = parse_failure_count
        self.validation_failure_count = validation_failure_count
        self.first_failure_reason = first_failure_reason
        self.first_invalid_preview = first_invalid_preview

    def __str__(self) -> str:
        return (
            f"{super().__str__()}\n"
            f"  parse_failures={self.parse_failure_count}, "
            f"validation_failures={self.validation_failure_count}\n"
            f"  first_failure: {self.first_failure_reason}"
        )


def _validate_architect_event(
    event: dict[str, Any],
    seen_node_ids: set[str],
    seen_parent_ids: set[str],
    trace_id: str | None,
) -> tuple[bool, str | None]:
    action = event.get("action")
    if action not in VALID_ACTIONS:
        return False, f"invalid action '{action}' — must be 'add_node' or 'add_edge'"

    if action == "add_node":
        return _validate_node_event(event, seen_node_ids, trace_id)
    elif action == "add_edge":
        return _validate_edge_event(event, seen_node_ids, trace_id)
    return False, "unknown action"


def _validate_node_event(
    event: dict[str, Any],
    seen_node_ids: set[str],
    trace_id: str | None,
) -> tuple[bool, str | None]:
    node_id = event.get("id")
    if not node_id or not isinstance(node_id, str) or not node_id.strip():
        return False, "add_node missing required field 'id' (must be non-empty string)"

    label = event.get("label")
    if not label or not isinstance(label, str) or not label.strip():
        return False, "add_node missing required field 'label' (must be non-empty string)"

    category = event.get("category")
    if category not in VALID_CATEGORIES:
        return False, f"invalid category '{category}' — must be one of {sorted(VALID_CATEGORIES)}"

    node_type = event.get("node_type")
    if node_type is not None and node_type not in VALID_NODE_TYPES:
        return False, f"invalid node_type '{node_type}' — must be 'container' or 'service'"

    container_type = event.get("container_type")
    if container_type is not None:
        if container_type not in VALID_CONTAINER_TYPES:
            return False, f"invalid container_type '{container_type}' — must be one of {sorted(VALID_CONTAINER_TYPES)}"
        if node_type is not None and node_type != "container":
            return False, f"container_type '{container_type}' is only valid when node_type='container', got node_type='{node_type}'"

    if node_type == "service" and container_type is not None:
        return False, f"service nodes cannot have container_type — got container_type='{container_type}'"

    if node_id in seen_node_ids:
        return False, f"duplicate node id '{node_id}' — each node id must be unique"

    parent_id = event.get("parent_id")
    if parent_id is not None and parent_id not in seen_node_ids:
        return False, f"parent_id '{parent_id}' references node that has not been emitted yet"

    return True, None


def _validate_edge_event(
    event: dict[str, Any],
    seen_node_ids: set[str],
    trace_id: str | None,
) -> tuple[bool, str | None]:
    from_node = event.get("from")
    to_node = event.get("to")
    label = event.get("label")

    if not from_node or not isinstance(from_node, str) or not from_node.strip():
        return False, "add_edge missing required field 'from' (must be non-empty string)"

    if not to_node or not isinstance(to_node, str) or not to_node.strip():
        return False, "add_edge missing required field 'to' (must be non-empty string)"

    if not label or not isinstance(label, str) or not label.strip():
        return False, "add_edge missing required field 'label' (must be non-empty string)"

    if from_node not in seen_node_ids:
        return False, f"add_edge 'from' references unknown node '{from_node}'"

    if to_node not in seen_node_ids:
        return False, f"add_edge 'to' references unknown node '{to_node}'"

    return True, None

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

REPAIR_SYSTEM = """You are an AWS architecture diagram repair specialist for DrawToCloud.

The previous architect output was invalid and must be corrected. Your task is to emit a valid sequence of diagram events.

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

async def repair_architecture(
    requirements: dict,
    invalid_output: str,
    error_info: dict,
    websocket,
    start_time: float = 0,
    llm_creds: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Repair invalid architect output and return valid event lines.

    Args:
        requirements: The original requirements JSON.
        invalid_output: The invalid architect output (raw string).
        error_info: Dict with parse_failure_count, validation_failure_count, first_failure_reason, first_invalid_preview.
        websocket: WebSocket for sending events.
        start_time: Start time for logging.
        llm_creds: Optional LLM credentials.

    Returns:
        List of valid diagram events.

    Raises:
        ArchitectOutputError: If repair fails to produce valid output.
    """
    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None

    failure_context = (
        f"Previous output had {error_info.get('parse_failure_count', 0)} parse failures "
        f"and {error_info.get('validation_failure_count', 0)} validation failures. "
        f"First failure: {error_info.get('first_failure_reason', 'unknown')}. "
        f"Preview: {error_info.get('first_invalid_preview', '')[:200]}"
    )

    user_message = json.dumps({
        "requirements": requirements,
        "failure_context": failure_context,
        "invalid_output": invalid_output,
    })

    logger.info("architect.repair_started trace_id=%s", trace_id)

    buffer = ""
    all_valid_events: list[dict[str, Any]] = []
    seen_node_ids: set[str] = set()
    parse_failure_count = 0
    validation_failure_count = 0
    first_failure_reason = ""
    first_invalid_preview = ""

    async def process_repair_line(line: str) -> None:
        nonlocal parse_failure_count, validation_failure_count, first_failure_reason, first_invalid_preview
        line = line.strip()
        if not line:
            return
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("Event must be a JSON object")
            is_valid, error_reason = _validate_architect_event(event, seen_node_ids, set(), trace_id)
            if not is_valid:
                validation_failure_count += 1
                if not first_failure_reason:
                    first_failure_reason = error_reason or "validation_error"
                    first_invalid_preview = line[:200]
                logger.warning(
                    "architect.repair_validation_error trace_id=%s reason=%s line_preview=%r",
                    trace_id,
                    error_reason,
                    line[:200],
                )
                return
            all_valid_events.append(event)
            await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
            if event.get("action") == "add_node":
                node_id = event.get("id")
                if node_id:
                    seen_node_ids.add(node_id)
        except (json.JSONDecodeError, ValueError, TypeError):
            parse_failure_count += 1
            if not first_failure_reason:
                first_failure_reason = "json_parse_error"
                first_invalid_preview = line[:200]
            logger.warning(
                "architect.repair_parse_error trace_id=%s line_preview=%r",
                trace_id,
                line[:200],
            )

    async for chunk in async_stream_text(
        messages=[{"role": "user", "content": user_message}],
        system=REPAIR_SYSTEM,
        llm_creds=llm_creds,
        log_context={"agent": "architect", "trace_id": trace_id},
    ):
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            await process_repair_line(line)

    if buffer.strip():
        await process_repair_line(buffer)

    if len(all_valid_events) == 0:
        raise ArchitectOutputError(
            message="Repair produced no valid nodes",
            raw_preview=invalid_output[:500],
            parse_failure_count=parse_failure_count,
            validation_failure_count=validation_failure_count,
            first_failure_reason=first_failure_reason or "no valid events produced",
            first_invalid_preview=first_invalid_preview,
        )

    logger.info(
        "architect.repair_completed trace_id=%s valid_events=%d",
        trace_id,
        len(all_valid_events),
    )
    return all_valid_events


async def stream_architecture(
    requirements: dict,
    websocket,
    start_time: float = 0,
    llm_creds: dict[str, Any] | None = None,
    emit_milestone: Callable[[str, str, str, bool, str | None], None] | None = None,
) -> None:
    async def milestone(status: str, event_type: str, message: str, history: bool = False, error: str | None = None) -> None:
        if emit_milestone is not None:
            result = emit_milestone(status, event_type, message, history, error)
            if asyncio.iscoroutine(result):
                await result

    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None
    await emit_log(websocket, "architect", "Designing architecture...", start_time, trace_id=trace_id)
    logger.info("architect.started trace_id=%s", trace_id)
    await milestone("running", "started", "Starting architecture design", history=True)
    await milestone("running", "waiting_for_first_event", "Waiting for architecture output", history=False)
    buffer = ""
    stream_chunks_log: deque[str] = deque(maxlen=300)
    first_node_emitted = False
    consecutive_bad_lines = 0
    node_count = 0
    edge_count = 0
    last_valid_line_at = time.monotonic()
    stall_warned = False
    seen_node_ids: set[str] = set()
    parse_failure_count = 0
    validation_failure_count = 0
    first_failure_reason = ""
    first_invalid_preview = ""
    waiting_for_first = True
    network_started = False
    service_started = False
    connections_started = False

    def _raise_output_error(message: str) -> None:
        raise ArchitectOutputError(
            message=message,
            raw_preview="\n".join(list(stream_chunks_log)[-10:]),
            parse_failure_count=parse_failure_count,
            validation_failure_count=validation_failure_count,
            first_failure_reason=first_failure_reason,
            first_invalid_preview=first_invalid_preview,
        )

    async def process_line(line: str) -> None:
        nonlocal first_node_emitted, consecutive_bad_lines, node_count, edge_count, last_valid_line_at, stall_warned
        nonlocal seen_node_ids, parse_failure_count, validation_failure_count, first_failure_reason, first_invalid_preview
        nonlocal waiting_for_first, network_started, service_started, connections_started
        line = line.strip()
        if not line:
            return
        stream_chunks_log.append(line)
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("Architect event must be a JSON object")

            is_valid, error_reason = _validate_architect_event(event, seen_node_ids, set(), trace_id)
            if not is_valid:
                consecutive_bad_lines += 1
                validation_failure_count += 1
                if not first_failure_reason:
                    first_failure_reason = error_reason or "validation_error"
                    first_invalid_preview = line[:200]
                logger.warning(
                    "architect.validation_error trace_id=%s reason=%s line_preview=%r validation_failure_count=%d",
                    trace_id,
                    error_reason,
                    line[:200],
                    validation_failure_count,
                )
                if first_node_emitted:
                    await websocket.send_text(json.dumps({
                        "type": "pipeline_event",
                        "stage": "architect",
                        "event": "validation_error",
                        "level": "warning",
                        "message": f"Skipped invalid event from architect: {error_reason} (consecutive: {consecutive_bad_lines})",
                    }))
                if first_node_emitted and consecutive_bad_lines >= 3:
                    _raise_output_error(
                        f"Architect agent emitted {consecutive_bad_lines} consecutive invalid lines; aborting."
                    )
                return

            if event.get("action") == "add_node":
                if waiting_for_first:
                    waiting_for_first = False
                await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                last_valid_line_at = time.monotonic()
                stall_warned = False
                node_count += 1
                first_node_emitted = True
                consecutive_bad_lines = 0
                node_id = event.get("id")
                if node_id:
                    seen_node_ids.add(node_id)
                container_type = event.get("container_type")
                if container_type in ("region", "vpc", "az", "subnet") and not network_started:
                    network_started = True
                    await milestone("running", "network_layout_started", "Laying out networking components", history=True)
                elif event.get("node_type") == "service" and not service_started:
                    service_started = True
                    await milestone("running", "service_layout_started", "Adding application services", history=True)
                await emit_log(
                    websocket,
                    "architect",
                    f"Added {event['label']} ({event.get('category', '')})",
                    start_time,
                    trace_id=trace_id,
                )
            elif event.get("action") == "add_edge":
                if waiting_for_first:
                    waiting_for_first = False
                await websocket.send_text(json.dumps({"type": "diagram_event", **event}))
                last_valid_line_at = time.monotonic()
                edge_count += 1
                stall_warned = False
                consecutive_bad_lines = 0
                if not connections_started:
                    connections_started = True
                    await milestone("running", "connections_started", "Connecting AWS services", history=True)
                await emit_log(
                    websocket,
                    "architect",
                    f"Connected {event.get('from')} -> {event.get('to')}",
                    start_time,
                    trace_id=trace_id,
                )
            await asyncio.sleep(0.3)
        except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
            consecutive_bad_lines += 1
            parse_failure_count += 1
            if not first_failure_reason:
                first_failure_reason = "json_parse_error"
                first_invalid_preview = line[:200]
            logger.warning(
                "Architect parse failure: consecutive_bad_lines=%d reason=%s line_preview=%r parse_failure_count=%d",
                consecutive_bad_lines,
                "json_parse_error",
                line[:200],
                parse_failure_count,
            )
            await milestone("running", "parse_warning", "Skipping malformed architecture output", history=True)
            if first_node_emitted:
                await websocket.send_text(json.dumps({
                    "type": "pipeline_event",
                    "stage": "architect",
                    "event": "parse_warning",
                    "level": "warning",
                    "message": f"Skipped non-JSON line from architect (consecutive: {consecutive_bad_lines})",
                }))
            if first_node_emitted and consecutive_bad_lines >= 3:
                _raise_output_error(
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
                await milestone("running", "stall_warning", "Architecture generation is taking longer than expected", history=True)
                logger.warning("architect.stall_warning trace_id=%s idle_seconds=%d", trace_id, int(now - last_valid_line_at))
        buffer += chunk
        stream_chunks_log.append(chunk)
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            await process_line(line)
    if buffer.strip():
        await process_line(buffer)
    if node_count == 0:
        if not first_failure_reason:
            first_failure_reason = "empty_stream"
        _raise_output_error("Architect agent produced no valid nodes.")
    await emit_log(
        websocket,
        "architect",
        f"Architecture complete ({node_count} nodes, {edge_count} edges)",
        start_time,
        trace_id=trace_id,
        details={"nodes": node_count, "edges": edge_count},
    )
    logger.info("architect.completed trace_id=%s nodes=%d edges=%d", trace_id, node_count, edge_count)
    await milestone("completed", "completed", "Architecture ready", history=True)
