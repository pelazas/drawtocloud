import asyncio
import copy
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from agents.architect import stream_architecture
from agents.cost_analyst import run_cost_analyst
from agents.coder import stream_terraform_files
from agents.description import run_description_agent
from agents.log_helper import emit_log
from agents.requirements import generate_requirements
from admin import is_admin_email
from llm_keys import LlmKeyDecryptError, get_user_llm_key
from project_store import append_chat_message, create_project_for_generation, derive_project_title, get_project_for_user, update_project_fields
from quota import check_and_reserve_quota
from thumbnail_generator import generate_and_upload_thumbnail

logger = logging.getLogger(__name__)

REQUIREMENTS_ATTEMPT_TIMEOUT_SECONDS = 90.0
REQUIREMENTS_MAX_ATTEMPTS = 2

_GENERIC_CONTEXT_PHRASES = {
    "app",
    "application",
    "web app",
    "mobile app",
    "saas app",
    "my app",
    "demo",
    "test",
}


class GenerationStartError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class BudgetCapUnmetError(Exception):
    def __init__(self, budget_cap: float, estimated_total: float) -> None:
        self.code = "budget_cap_unmet"
        self.budget_cap = round(float(budget_cap), 2)
        self.estimated_total = round(float(estimated_total), 2)
        message = (
            f"Budget hard cap unmet: cap=${self.budget_cap:.2f}, "
            f"estimated_total=${self.estimated_total:.2f} after one optimization pass."
        )
        super().__init__(message)
        self.message = message


def _format_usd(amount: float) -> str:
    return f"${amount:,.2f}"


def build_budget_cap_recovery_assistant_message(
    budget_cap: float,
    estimated_total: float,
    overage: float | None = None,
) -> str:
    resolved_overage = round(max(estimated_total - budget_cap, 0.0), 2) if overage is None else round(overage, 2)
    return (
        f"The generated architecture is estimated at {_format_usd(estimated_total)}/mo, "
        f"{_format_usd(resolved_overage)} over your {_format_usd(budget_cap)} budget. "
        "Reply with \"retry\" to run another tighter pass, or \"accept\" to continue with this architecture."
    )


class PersistenceState:
    def __init__(self, project_id: str, user_id: str, seed: dict[str, Any] | None = None) -> None:
        seed = seed or {}
        self.project_id = project_id
        self.user_id = user_id
        self.nodes = seed.get("nodes") if isinstance(seed.get("nodes"), list) else []
        self.edges = seed.get("edges") if isinstance(seed.get("edges"), list) else []
        self.terraform_files = seed.get("terraform_files") if isinstance(seed.get("terraform_files"), list) else []
        self.cost_estimate = seed.get("cost_estimate")
        self.chat_history = seed.get("chat_history") if isinstance(seed.get("chat_history"), list) else []
        self.arch_description = seed.get("arch_description") if isinstance(seed.get("arch_description"), dict) else None

    def upsert_node(self, node_payload: dict[str, Any]) -> None:
        node_id = node_payload.get("id")
        if not isinstance(node_id, str):
            return

        for index, node in enumerate(self.nodes):
            if isinstance(node, dict) and node.get("id") == node_id:
                self.nodes[index] = node_payload
                return

        self.nodes.append(node_payload)

    def upsert_edge(self, edge_payload: dict[str, Any]) -> None:
        edge_id = edge_payload.get("id")
        if not isinstance(edge_id, str):
            return

        for index, edge in enumerate(self.edges):
            if isinstance(edge, dict) and edge.get("id") == edge_id:
                self.edges[index] = edge_payload
                return

        self.edges.append(edge_payload)

    def upsert_terraform_file(self, terraform_payload: dict[str, Any]) -> None:
        filename = terraform_payload.get("filename")
        if not isinstance(filename, str):
            return

        for index, file_entry in enumerate(self.terraform_files):
            if isinstance(file_entry, dict) and file_entry.get("filename") == filename:
                self.terraform_files[index] = terraform_payload
                return

        self.terraform_files.append(terraform_payload)

    def append_chat(self, role: str, content: str) -> None:
        self.chat_history.append({"role": role, "content": content})

    def serialized_description(self) -> str | None:
        if not isinstance(self.arch_description, dict):
            return None
        try:
            return json.dumps(self.arch_description)
        except (TypeError, ValueError):
            return None


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_unix() -> int:
    return int(time.time())


def _parse_arch_description(raw_description: Any) -> dict[str, Any] | None:
    if isinstance(raw_description, dict):
        return raw_description

    if isinstance(raw_description, str) and raw_description.strip():
        try:
            decoded = json.loads(raw_description)
            if isinstance(decoded, dict):
                return decoded
        except json.JSONDecodeError:
            return None

    return None


def _seed_from_project_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": row.get("nodes") if isinstance(row.get("nodes"), list) else [],
        "edges": row.get("edges") if isinstance(row.get("edges"), list) else [],
        "terraform_files": row.get("terraform_files") if isinstance(row.get("terraform_files"), list) else [],
        "cost_estimate": row.get("cost_estimate"),
        "chat_history": row.get("chat_history") if isinstance(row.get("chat_history"), list) else [],
        "arch_description": _parse_arch_description(row.get("description")),
    }


def _normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _word_count(value: str) -> int:
    return len(re.findall(r"[A-Za-z0-9_]+", value))


def _is_truthy_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "approved"}
    return False


def has_sufficient_generation_context(answers: Any) -> bool:
    """Return whether answers are detailed enough for immediate generation."""
    if not isinstance(answers, dict):
        return False

    if _is_truthy_flag(answers.get("_approved_plan")):
        return True

    conversation_summary = _normalize_text(answers.get("conversation_summary"))
    if conversation_summary and len(conversation_summary) >= 80 and _word_count(conversation_summary) >= 12:
        return True

    description = _normalize_text(answers.get("description"))
    if not description:
        return False

    normalized_description = description.lower()
    if normalized_description in _GENERIC_CONTEXT_PHRASES:
        return False

    if len(description) < 30:
        return False

    if _word_count(description) < 6:
        return False

    return True


def _is_send_after_close_error(error: Exception) -> bool:
    return isinstance(error, RuntimeError) and 'Cannot call "send" once a close message has been sent.' in str(error)


def _as_valid_number(value: Any) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return round(float(value), 2)


def _read_budget_cap_from_cost_estimate(cost_estimate: Any) -> float | None:
    if not isinstance(cost_estimate, dict):
        return None
    budget_cap = _as_valid_number(cost_estimate.get("budget_cap"))
    if budget_cap is None:
        budget_cap = _as_valid_number(cost_estimate.get("monthly_budget"))
    return budget_cap


def _read_estimated_total_from_cost_estimate(cost_estimate: Any) -> float | None:
    if not isinstance(cost_estimate, dict):
        return None
    return _as_valid_number(cost_estimate.get("monthly_total"))


def _is_over_budget_from_cost_estimate(cost_estimate: Any) -> bool:
    if not isinstance(cost_estimate, dict):
        return False

    over_budget = cost_estimate.get("over_budget")
    if isinstance(over_budget, bool):
        return over_budget

    budget_cap = _read_budget_cap_from_cost_estimate(cost_estimate)
    estimated_total = _read_estimated_total_from_cost_estimate(cost_estimate)
    if budget_cap is None or estimated_total is None:
        return False
    return estimated_total > budget_cap


def _runtime_budget_cap(runtime: "GenerationRuntime") -> float | None:
    return _read_budget_cap_from_cost_estimate(runtime.persistence.cost_estimate)


def _runtime_estimated_total(runtime: "GenerationRuntime") -> float | None:
    return _read_estimated_total_from_cost_estimate(runtime.persistence.cost_estimate)


def _runtime_is_over_budget(runtime: "GenerationRuntime") -> bool:
    return _is_over_budget_from_cost_estimate(runtime.persistence.cost_estimate)


_INSTANCE_SIZE_ORDER = (
    "nano",
    "micro",
    "small",
    "medium",
    "large",
    "xlarge",
    "2xlarge",
    "3xlarge",
    "4xlarge",
    "6xlarge",
    "8xlarge",
    "9xlarge",
    "10xlarge",
    "12xlarge",
    "16xlarge",
    "18xlarge",
    "24xlarge",
    "32xlarge",
    "48xlarge",
)


def _downsize_instance_type(instance_type: Any) -> str | None:
    if not isinstance(instance_type, str) or "." not in instance_type:
        return None
    family, size = instance_type.rsplit(".", 1)
    if not family:
        return None
    normalized = size.strip().lower()
    if normalized not in _INSTANCE_SIZE_ORDER:
        return None
    index = _INSTANCE_SIZE_ORDER.index(normalized)
    if index <= 0:
        return None
    return f"{family}.{_INSTANCE_SIZE_ORDER[index - 1]}"


def _build_budget_cost_feedback(cost_estimate: Any, *, max_items: int = 5) -> list[str]:
    if not isinstance(cost_estimate, dict):
        return []
    raw_items = cost_estimate.get("items")
    if not isinstance(raw_items, list):
        return []

    parsed: list[tuple[float, str, str | None]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        label = item.get("label")
        cost = _as_valid_number(item.get("cost"))
        if not isinstance(label, str) or not label.strip() or cost is None:
            continue
        parsed.append((cost, label.strip(), item.get("instance_type") if isinstance(item.get("instance_type"), str) else None))

    feedback: list[str] = []
    for cost, label, instance_type in sorted(parsed, key=lambda entry: entry[0], reverse=True)[:max_items]:
        if instance_type:
            feedback.append(f"{label}: ${cost:.2f}/mo ({instance_type})")
        else:
            feedback.append(f"{label}: ${cost:.2f}/mo")
    return feedback


def _apply_budget_instance_downsizes(nodes: Any, cost_estimate: Any) -> int:
    if not isinstance(nodes, list) or not isinstance(cost_estimate, dict):
        return 0
    raw_items = cost_estimate.get("items")
    if not isinstance(raw_items, list):
        return 0

    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            by_id[node["id"]] = node

    candidates: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        node_id = item.get("node_id")
        cost = _as_valid_number(item.get("cost"))
        if not isinstance(node_id, str) or cost is None:
            continue
        candidates.append({"node_id": node_id, "cost": cost, "instance_type": item.get("instance_type")})

    changes = 0
    for candidate in sorted(candidates, key=lambda entry: float(entry["cost"]), reverse=True):
        node = by_id.get(candidate["node_id"])
        if not isinstance(node, dict):
            continue
        data = node.get("data")
        if not isinstance(data, dict):
            continue
        current_instance = data.get("instance_type")
        if not isinstance(current_instance, str):
            fallback_instance = candidate.get("instance_type")
            current_instance = fallback_instance if isinstance(fallback_instance, str) else None
        next_instance = _downsize_instance_type(current_instance)
        if not next_instance:
            continue
        data["instance_type"] = next_instance
        changes += 1
    return changes


def _build_strict_budget_requirements(
    requirements: dict[str, Any],
    budget_cap: float,
    estimated_total: float,
    *,
    cost_estimate: Any | None = None,
) -> dict[str, Any]:
    overage = round(max(estimated_total - budget_cap, 0.0), 2)
    strict_requirements = {
        **requirements,
        "monthly_budget": budget_cap,
        "budget_cap": budget_cap,
        "budget_is_hard_cap": True,
        "budget_enforcement_mode": "strict",
        "budget_current_estimated_total": estimated_total,
        "budget_current_overage": overage,
        "budget_optimization_instruction": (
            f"HARD CAP: keep estimated monthly total <= ${budget_cap:.2f}. "
            f"Current estimate is ${estimated_total:.2f} (${overage:.2f} over budget); "
            "optimize aggressively — downsize instances, remove non-essential services, "
            "eliminate NAT Gateway and multi-AZ unless compliance demands it."
        ),
    }
    cost_feedback = _build_budget_cost_feedback(cost_estimate)
    if cost_feedback:
        strict_requirements["budget_cost_feedback"] = cost_feedback
    return strict_requirements


def _snapshot_has_nodes(snapshot: dict[str, Any] | None) -> bool:
    return (
        isinstance(snapshot, dict)
        and isinstance(snapshot.get("nodes"), list)
        and len(snapshot.get("nodes") or []) > 0
    )


async def _emit_canvas_snapshot(
    runtime: "GenerationRuntime",
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    cost_estimate: dict[str, Any] | None,
) -> None:
    runtime.persistence.nodes = copy.deepcopy(nodes)
    runtime.persistence.edges = copy.deepcopy(edges)
    runtime.persistence.cost_estimate = copy.deepcopy(cost_estimate)
    await update_project_fields(
        runtime.project_id,
        runtime.user_id,
        {
            "nodes": runtime.persistence.nodes,
            "edges": runtime.persistence.edges,
            "cost_estimate": runtime.persistence.cost_estimate,
            "last_event_at": _now_utc_iso(),
        },
    )
    await runtime.send_text(json.dumps({"type": "diagram_reset"}))

    for node in runtime.persistence.nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        payload: dict[str, Any] = {
            "type": "diagram_event",
            "action": "add_node",
            "id": node_id,
            "label": data.get("label") if isinstance(data.get("label"), str) else node_id,
            "category": data.get("category") if isinstance(data.get("category"), str) else "default",
            "node_type": "container" if node.get("type") == "container" else "service",
            "position": node.get("position") if isinstance(node.get("position"), dict) else {"x": 0, "y": 0},
        }
        container_type = data.get("containerType") if node.get("type") == "container" else None
        if isinstance(container_type, str) and container_type.strip():
            payload["container_type"] = container_type.strip()
        style = node.get("style")
        if isinstance(style, dict) and style:
            payload["style"] = style
        parent_id = node.get("parentId")
        if isinstance(parent_id, str) and parent_id.strip():
            payload["parent_id"] = parent_id
        for key in ("aws_service_code", "instance_type", "engine"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                payload[key] = value.strip()
        await runtime.send_text(json.dumps(payload))

    for edge in runtime.persistence.edges:
        if not isinstance(edge, dict):
            continue
        source = edge.get("source")
        target = edge.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        payload = {
            "type": "diagram_event",
            "action": "add_edge",
            "from": source,
            "to": target,
            "label": edge.get("label") if isinstance(edge.get("label"), str) else "",
        }
        await runtime.send_text(json.dumps(payload))

    if isinstance(runtime.persistence.cost_estimate, dict):
        await runtime.send_text(json.dumps({"type": "cost_estimate", **runtime.persistence.cost_estimate}))


_SPECIALIST_HEARTBEAT_SECONDS = 8.0
_SPECIALIST_RETRY_CONFIG: dict[str, dict[str, float | int]] = {
    "coder": {
        "max_retries": 1,
        "backoff_ms": 200,
        "attempt_timeout_seconds": 390,
    },
    "description": {
        "max_retries": 1,
        "backoff_ms": 250,
        "attempt_timeout_seconds": 120,
    },
}


def _specialist_config_for(stage: str) -> dict[str, float | int]:
    configured = _SPECIALIST_RETRY_CONFIG.get(stage)
    if isinstance(configured, dict):
        return configured
    return {
        "max_retries": 0,
        "backoff_ms": 0,
        "attempt_timeout_seconds": 120,
    }


async def _run_specialists_with_retries(
    runtime: "GenerationRuntime",
    factories: dict[str, Callable[[], Awaitable[None]]],
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    states: dict[str, dict[str, Any]] = {
        name: {
            "state": "queued",
            "attempts": 0,
            "retries_used": 0,
            "max_retries": int(_specialist_config_for(name).get("max_retries", 0) or 0),
            "last_error": None,
        }
        for name in factories
    }

    async def _run_single(stage: str, factory: Callable[[], Awaitable[None]]) -> None:
        config = _specialist_config_for(stage)
        max_retries = int(config.get("max_retries", 0) or 0)
        backoff_ms = int(config.get("backoff_ms", 0) or 0)
        attempt_timeout_seconds = float(config.get("attempt_timeout_seconds", 120) or 120)
        max_attempts = max_retries + 1

        for attempt in range(1, max_attempts + 1):
            is_retry = attempt > 1
            current_state = f"retrying({attempt - 1})" if is_retry else "running"
            states[stage]["state"] = current_state
            states[stage]["attempts"] = attempt
            states[stage]["retries_used"] = attempt - 1
            details = {
                "state": current_state,
                "attempt": attempt,
                "max_retries": max_retries,
                "attempt_timeout_seconds": attempt_timeout_seconds,
            }

            if is_retry:
                await runtime.emit_pipeline_event(
                    stage,
                    "retrying",
                    "warning",
                    f"{stage} retry {attempt - 1}/{max_retries} started",
                    details,
                )
            else:
                await runtime.emit_pipeline_event(stage, "started", "info", f"{stage} started", details)

            stage_task = asyncio.create_task(asyncio.wait_for(factory(), timeout=attempt_timeout_seconds))
            attempt_started_at = loop.time()
            while not stage_task.done():
                done, _pending = await asyncio.wait({stage_task}, timeout=_SPECIALIST_HEARTBEAT_SECONDS)
                if stage_task in done:
                    break
                elapsed_ms = int((loop.time() - attempt_started_at) * 1000)
                await runtime.emit_pipeline_event(
                    stage,
                    "still_running",
                    "info",
                    f"{stage} still running",
                    {
                        "state": current_state,
                        "attempt": attempt,
                        "elapsed_ms": elapsed_ms,
                    },
                )

            try:
                await stage_task
            except Exception as error:
                error_message = str(error)
                states[stage]["last_error"] = error_message
                if attempt < max_attempts:
                    await runtime.emit_pipeline_event(
                        stage,
                        "attempt_failed",
                        "warning",
                        f"{stage} attempt {attempt} failed; retrying",
                        {
                            "state": current_state,
                            "attempt": attempt,
                            "max_retries": max_retries,
                            "error": error_message,
                        },
                    )
                    computed_backoff_ms = backoff_ms * (2 ** (attempt - 1))
                    if computed_backoff_ms > 0:
                        await asyncio.sleep(computed_backoff_ms / 1000)
                    continue

                states[stage]["state"] = "failed_after_retries"
                await runtime.emit_pipeline_event(
                    stage,
                    "failed_after_retries",
                    "warning",
                    f"{stage} failed after retries",
                    {
                        "state": "failed_after_retries",
                        "attempts": attempt,
                        "max_retries": max_retries,
                        "error": error_message,
                    },
                )
                return

            states[stage]["state"] = "completed"
            states[stage]["last_error"] = None
            await runtime.emit_pipeline_event(
                stage,
                "completed",
                "info",
                f"{stage} completed",
                {
                    "state": "completed",
                    "attempts": attempt,
                    "retries_used": attempt - 1,
                    "elapsed_ms": int((loop.time() - attempt_started_at) * 1000),
                },
            )
            return

    async with asyncio.TaskGroup() as tg:
        for stage, factory in factories.items():
            tg.create_task(_run_single(stage, factory))

    completed_count = 0
    failed_count = 0
    for specialist_state in states.values():
        if specialist_state.get("state") == "completed":
            completed_count += 1
        else:
            failed_count += 1

    return {
        "total": len(states),
        "completed": completed_count,
        "failed_after_retries": failed_count,
        "all_terminal": True,
        "specialists": states,
    }


class ProjectBroadcaster:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, project_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            listeners = self._subscribers.setdefault(project_id, set())
            listeners.add(websocket)

    async def unsubscribe(self, project_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            listeners = self._subscribers.get(project_id)
            if not listeners:
                return
            listeners.discard(websocket)
            if not listeners:
                self._subscribers.pop(project_id, None)

    async def unsubscribe_from_all(self, websocket: WebSocket) -> None:
        async with self._lock:
            project_ids = [project_id for project_id, listeners in self._subscribers.items() if websocket in listeners]
            for project_id in project_ids:
                listeners = self._subscribers.get(project_id)
                if not listeners:
                    continue
                listeners.discard(websocket)
                if not listeners:
                    self._subscribers.pop(project_id, None)

    async def broadcast(self, project_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            listeners = list(self._subscribers.get(project_id, set()))

        if not listeners:
            return

        serialized = json.dumps(payload)
        dead: list[WebSocket] = []
        for websocket in listeners:
            try:
                await websocket.send_text(serialized)
            except WebSocketDisconnect:
                dead.append(websocket)
            except RuntimeError as error:
                if _is_send_after_close_error(error):
                    dead.append(websocket)
                else:
                    raise

        for websocket in dead:
            await self.unsubscribe(project_id, websocket)

    async def send_ping_to_all(self) -> None:
        """Send ping to all connected websockets to keep connections alive."""
        async with self._lock:
            snapshot = {project_id: list(listeners) for project_id, listeners in self._subscribers.items()}

        if not snapshot:
            return

        payload = json.dumps({"type": "ping", "ts": time.time()})
        dead: list[tuple[str, WebSocket]] = []

        for project_id, listeners in snapshot.items():
            for websocket in listeners:
                try:
                    await websocket.send_text(payload)
                except WebSocketDisconnect:
                    dead.append((project_id, websocket))
                except (ConnectionResetError, BrokenPipeError):
                    dead.append((project_id, websocket))
                except RuntimeError as error:
                    if _is_send_after_close_error(error):
                        dead.append((project_id, websocket))
                    else:
                        raise

        for project_id, websocket in dead:
            await self.unsubscribe(project_id, websocket)


class GenerationRuntime:
    def __init__(
        self,
        project_id: str,
        user_id: str,
        trace_id: str,
        is_admin: bool,
        persistence: PersistenceState,
        broadcaster: ProjectBroadcaster,
        llm_creds: dict[str, Any] | None = None,
        client_ip: str | None = None,
    ) -> None:
        self.project_id = project_id
        self.user_id = user_id
        self.trace_id = trace_id
        self.is_admin = is_admin
        self.persistence = persistence
        self.broadcaster = broadcaster
        self.llm_creds = llm_creds
        self.client_ip = client_ip
        self._generation_observability: list[dict[str, Any]] | None = None

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        enriched = {
            **payload,
            "trace_id": self.trace_id,
            "project_id": self.project_id,
        }
        await self.broadcaster.broadcast(self.project_id, enriched)

    async def _touch_generation(self, fields: dict[str, Any]) -> None:
        await update_project_fields(
            self.project_id,
            self.user_id,
            {
                "generation_trace_id": self.trace_id,
                "last_event_at": _now_utc_iso(),
                **fields,
            },
        )

    async def set_generation_state(
        self,
        status: str,
        stage: str | None = None,
        error: str | None = None,
        completed: bool = False,
    ) -> None:
        fields: dict[str, Any] = {
            "generation_status": status,
            "generation_stage": stage,
            "generation_error": error,
        }
        if completed:
            fields["generation_completed_at"] = _now_utc_iso()
        await self._touch_generation(fields)

    async def emit_pipeline_event(
        self,
        stage: str,
        event: str,
        level: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        await self._touch_generation({"generation_stage": stage})
        payload = {
            "type": "pipeline_event",
            "stage": stage,
            "event": event,
            "level": level,
            "message": message,
            "ts": _now_unix(),
        }
        if details:
            payload["details"] = details
        await self._broadcast(payload)

    async def _handle_diagram_event(self, data: dict) -> None:
        action = data.get("action")
        if action == "add_node":
            node_data = {"label": data.get("label"), "category": data.get("category")}
            container_type = data.get("container_type")
            if isinstance(container_type, str) and container_type.strip():
                node_data["containerType"] = container_type.strip()
            for field in ("aws_service_code", "instance_type", "engine"):
                value = data.get(field)
                if isinstance(value, str) and value.strip():
                    node_data[field] = value.strip()
            node = {
                "id": data.get("id"),
                "type": "container" if data.get("node_type") == "container" else "service",
                "position": {"x": 0, "y": 0},
                "data": node_data,
            }
            parent_id = data.get("parent_id")
            if isinstance(parent_id, str) and parent_id:
                node["parentId"] = parent_id
                node["extent"] = "parent"
            self.persistence.upsert_node(node)
            await update_project_fields(
                self.project_id,
                self.user_id,
                {
                    "nodes": self.persistence.nodes,
                    "edges": self.persistence.edges,
                    "last_event_at": _now_utc_iso(),
                },
            )
        elif action == "add_edge":
            source = data.get("from")
            target = data.get("to")
            if isinstance(source, str) and isinstance(target, str):
                edge = {
                    "id": f"{source}-{target}-{len(self.persistence.edges)}",
                    "source": source,
                    "target": target,
                    "label": data.get("label") or "",
                    "animated": True,
                    "style": {"stroke": "#6b7280"},
                }
                self.persistence.upsert_edge(edge)
                await update_project_fields(
                    self.project_id,
                    self.user_id,
                    {
                        "nodes": self.persistence.nodes,
                        "edges": self.persistence.edges,
                        "last_event_at": _now_utc_iso(),
                    },
                )

    async def _handle_terraform_file(self, data: dict) -> None:
        terraform_file = {
            "filename": data.get("filename"),
            "content": data.get("content"),
            "description": data.get("description") or "",
        }
        self.persistence.upsert_terraform_file(terraform_file)
        await update_project_fields(
            self.project_id,
            self.user_id,
            {
                "terraform_files": self.persistence.terraform_files,
                "last_event_at": _now_utc_iso(),
            },
        )

    async def _handle_arch_description(self, data: dict) -> None:
        sections = data.get("sections")
        if isinstance(sections, dict):
            self.persistence.arch_description = sections
            await update_project_fields(
                self.project_id,
                self.user_id,
                {"description": self.persistence.serialized_description(), "last_event_at": _now_utc_iso()},
            )

    async def _handle_done(self, data: dict) -> None:
        payload: dict[str, Any] = {
            "nodes": self.persistence.nodes,
            "edges": self.persistence.edges,
            "terraform_files": self.persistence.terraform_files,
            "cost_estimate": self.persistence.cost_estimate,
            "chat_history": self.persistence.chat_history,
            "description": self.persistence.serialized_description(),
            "last_event_at": _now_utc_iso(),
        }
        if self.persistence.terraform_files:
            payload["terraform_generated_at"] = _now_utc_iso()

        await update_project_fields(
            self.project_id,
            self.user_id,
            payload,
        )

    async def _handle_cost_estimate(self, data: dict) -> None:
        if not isinstance(data, dict):
            return

        self.persistence.cost_estimate = {
            key: value
            for key, value in data.items()
            if key not in {"type", "trace_id", "project_id"}
        }
        await update_project_fields(
            self.project_id,
            self.user_id,
            {
                "cost_estimate": self.persistence.cost_estimate,
                "last_event_at": _now_utc_iso(),
            },
        )

    async def _handle_pipeline_event(self, data: dict) -> None:
        stage = data.get("stage")
        await update_project_fields(
            self.project_id,
            self.user_id,
            {
                "generation_trace_id": self.trace_id,
                "generation_stage": stage if isinstance(stage, str) else None,
                "last_event_at": _now_utc_iso(),
            },
        )

    _HANDLERS: dict[str, Any] = {
        "diagram_event": _handle_diagram_event,
        "terraform_file": _handle_terraform_file,
        "arch_description": _handle_arch_description,
        "cost_estimate": _handle_cost_estimate,
        "done": _handle_done,
        "pipeline_event": _handle_pipeline_event,
    }

    async def send_text(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return

        handler = self._HANDLERS.get(data.get("type"))
        if handler:
            await handler(self, data)

        await self._broadcast(data)

    async def persist_partial_state(self) -> None:
        await update_project_fields(
            self.project_id,
            self.user_id,
            {
                "nodes": self.persistence.nodes,
                "edges": self.persistence.edges,
                "terraform_files": self.persistence.terraform_files,
                "cost_estimate": self.persistence.cost_estimate,
                "chat_history": self.persistence.chat_history,
                "description": self.persistence.serialized_description(),
            },
        )

    def init_generation_observability(self) -> None:
        self._generation_observability = _init_generation_observability()

    async def update_generation_agent(
        self,
        agent_name: str,
        status: str,
        *,
        error: str | None = None,
    ) -> None:
        if not self._generation_observability:
            return
        _update_generation_agent(
            self._generation_observability,
            agent_name,
            status,
            error=error,
        )
        await self.broadcast_generation_observability()

    def get_generation_observability_snapshot(self) -> list[dict[str, Any]] | None:
        if not self._generation_observability:
            return None
        return copy.deepcopy(self._generation_observability)

    async def broadcast_generation_observability(self) -> None:
        if not self._generation_observability:
            return
        payload = {
            "type": "generation_agent_update",
            "mode": "initial_generation",
            "agents": self._generation_observability,
        }
        await self._broadcast(payload)


_BROADCASTER = ProjectBroadcaster()
_RUNNING_TASKS: dict[str, asyncio.Task[None]] = {}
_RUNTIMES: dict[str, GenerationRuntime] = {}
_TASKS_LOCK = asyncio.Lock()


def get_generation_observability(project_id: str) -> list[dict[str, Any]] | None:
    runtime = _RUNTIMES.get(project_id)
    if not runtime:
        return None
    return runtime.get_generation_observability_snapshot()

_RERUN_AGENT_ORDER = ("coder", "description")


async def subscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.subscribe(project_id, websocket)


async def unsubscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe(project_id, websocket)


async def unsubscribe_websocket_from_all(websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe_from_all(websocket)


async def broadcast_project_event(project_id: str, payload: dict[str, Any]) -> None:
    await _BROADCASTER.broadcast(project_id, {**payload, "project_id": project_id})


async def append_chat_history(
    project_id: str,
    user_id: str,
    role: str,
    content: str,
    *,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Atomically append a chat message using the append_chat_message RPC.

    Replaces the previous read-modify-write pattern (get row, append in Python,
    write back) with a single atomic DB operation so concurrent appends to the
    same project cannot produce a lost update.
    """
    payload: dict[str, Any] = {"role": role, "content": content}
    if isinstance(metadata, dict):
        payload.update(metadata)
    await append_chat_message(project_id, user_id, payload)


def _build_rerun_answers(project_row: dict[str, Any], user_message: str | None = None) -> dict[str, Any]:
    base_answers = project_row.get("questionnaire_answers")
    answers = dict(base_answers) if isinstance(base_answers, dict) else {}
    history = project_row.get("chat_history") if isinstance(project_row.get("chat_history"), list) else []
    history_lines: list[str] = []
    for entry in history[-8:]:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            history_lines.append(f"{role}: {content.strip()}")
    if isinstance(user_message, str) and user_message.strip():
        history_lines.append(f"user: {user_message.strip()}")
    if history_lines:
        answers["conversation_summary"] = "\n".join(history_lines)
    if "description" not in answers and isinstance(user_message, str) and user_message.strip():
        answers["description"] = user_message.strip()
    answers["_approved_plan"] = True
    return answers


async def _run_agent_rerun(
    runtime: GenerationRuntime,
    answers: dict[str, Any],
    agent_names: tuple[str, ...],
    diagram_nodes: list[dict[str, Any]],
) -> None:
    user_id = runtime.user_id
    project_id = runtime.project_id
    llm_creds = getattr(runtime, "llm_creds", None)
    start_time = time.time()

    try:
        await runtime.set_generation_state(status="running", stage="rerun_requirements")
        await runtime.emit_pipeline_event("rerun", "started", "info", "Re-running selected agents")
        await runtime.send_text(json.dumps({"type": "status", "message": "Applying changes and refreshing outputs..."}))

        requirements = await _generate_requirements_with_retry(
            runtime,
            answers,
            llm_creds=llm_creds,
            stage="rerun_requirements",
        )
        await runtime.emit_pipeline_event("rerun_requirements", "completed", "info", "Rerun requirements prepared")

        if "coder" in agent_names:
            runtime.persistence.terraform_files = []
            runtime.persistence.cost_estimate = None
            await update_project_fields(
                project_id,
                user_id,
                {"terraform_files": [], "cost_estimate": None, "last_event_at": _now_utc_iso()},
            )

        specialist_factories: dict[str, Callable[[], Awaitable[None]]] = {}
        if "coder" in agent_names:
            specialist_factories["coder"] = lambda: stream_terraform_files(
                requirements,
                runtime,
                start_time,
                diagram_nodes=diagram_nodes,
                llm_creds=llm_creds,
            )
        if "description" in agent_names:
            specialist_factories["description"] = lambda: run_description_agent(
                requirements,
                runtime,
                start_time,
                diagram_nodes=diagram_nodes,
                llm_creds=llm_creds,
            )

        specialist_summary = await _run_specialists_with_retries(runtime, specialist_factories)
        failed_after_retries = int(specialist_summary.get("failed_after_retries", 0) or 0)
        if failed_after_retries > 0:
            failed_specialists = [
                stage
                for stage, state in specialist_summary.get("specialists", {}).items()
                if isinstance(state, dict) and state.get("state") != "completed"
            ]
            failed_joined = ", ".join(failed_specialists) if failed_specialists else "unknown"
            raise RuntimeError(f"Specialist rerun failed for: {failed_joined}")

        await runtime.send_text(json.dumps({"type": "done"}))

        # Regenerate OG thumbnail after rerun (nodes may have changed)
        # Use diagram_nodes (caller-supplied) — architect does not re-run during reruns,
        # so runtime.persistence.nodes is not repopulated. diagram_nodes is the current canvas state.
        _thumb_title = requirements.get("app_name") or "Untitled"
        _thumbnail_url = None
        try:
            _thumbnail_url = await asyncio.wait_for(
                generate_and_upload_thumbnail(
                    project_id,
                    _thumb_title,
                    diagram_nodes,
                    list(runtime.persistence.edges),
                ),
                timeout=15.0,
            )
        except Exception:
            logger.warning("Thumbnail generation timed out or failed project_id=%s", project_id)
        if _thumbnail_url:
            await update_project_fields(project_id, user_id, {"thumbnail_url": _thumbnail_url})

        await runtime.emit_pipeline_event(
            "rerun",
            "completed",
            "info",
            "Selected agents reached terminal states",
            specialist_summary,
        )
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
    except Exception as error:
        await runtime.persist_partial_state()
        await runtime.set_generation_state(status="failed", stage="failed", error=str(error), completed=True)
        await runtime.emit_pipeline_event("rerun", "failed", "error", "Agent rerun failed", {"error": str(error)})
        await runtime.send_text(json.dumps({"type": "error", "error": "rerun_failed", "message": str(error)}))
    finally:
        async with _TASKS_LOCK:
            _RUNNING_TASKS.pop(project_id, None)
            _RUNTIMES.pop(project_id, None)


async def rerun_project_agents_for_user(
    *,
    user_id: str,
    user_email: str,
    project_id: str,
    agent_names: list[str],
    user_message: str | None = None,
) -> dict[str, Any]:
    if not agent_names:
        raise GenerationStartError("invalid_rerun_request", "At least one agent must be selected for rerun.")

    deduped = tuple(agent for agent in _RERUN_AGENT_ORDER if agent in set(agent_names))
    if not deduped:
        raise GenerationStartError("invalid_rerun_request", "No supported agents selected for rerun.")

    llm_creds: dict[str, Any] | None = None
    try:
        llm_creds = await get_user_llm_key(user_id)
    except LlmKeyDecryptError as error:
        raise GenerationStartError("llm_key_decrypt_failed", str(error)) from error
    except Exception:
        llm_creds = None

    project_row = await get_project_for_user(project_id, user_id)
    answers = _build_rerun_answers(project_row, user_message=user_message)
    trace_id = str(uuid.uuid4())

    await update_project_fields(
        project_id,
        user_id,
        {
            "generation_trace_id": trace_id,
            "generation_status": "queued",
            "generation_stage": "queued",
            "generation_error": None,
            "generation_started_at": _now_utc_iso(),
            "generation_completed_at": None,
            "last_event_at": _now_utc_iso(),
        },
    )

    async with _TASKS_LOCK:
        running_task = _RUNNING_TASKS.get(project_id)
        if running_task and not running_task.done():
            raise GenerationStartError("generation_in_progress", "Generation is already running for this project.")

        runtime = GenerationRuntime(
            project_id=project_id,
            user_id=user_id,
            trace_id=trace_id,
            is_admin=is_admin_email(user_email),
            persistence=PersistenceState(project_id, user_id, _seed_from_project_row(project_row)),
            broadcaster=_BROADCASTER,
            llm_creds=llm_creds,
        )
        _RUNTIMES[project_id] = runtime
        task = asyncio.create_task(
            _run_agent_rerun(
                runtime=runtime,
                answers=answers,
                agent_names=deduped,
                diagram_nodes=list(project_row.get("nodes") or []),
            )
        )
        _RUNNING_TASKS[project_id] = task

    return {
        "project_id": project_id,
        "trace_id": trace_id,
        "generation_status": "queued",
        "agents": list(deduped),
    }


async def _prepare_existing_project_for_run(
    project_id: str,
    user_id: str,
    answers: Any,
    *,
    preserve_graph: bool = False,
) -> dict[str, Any]:
    project_row = await get_project_for_user(project_id, user_id)
    setup_pdf_status = project_row.get("setup_pdf_status")
    update_payload: dict[str, Any] = {
        "title": derive_project_title(answers),
        "project_mode": "default",
        "questionnaire_answers": (
            project_row.get("questionnaire_answers")
            if preserve_graph and isinstance(project_row.get("questionnaire_answers"), dict)
            else (answers if isinstance(answers, dict) else {})
        ),
        "generation_status": "queued",
        "generation_stage": "queued",
        "generation_error": None,
        "generation_started_at": _now_utc_iso(),
        "generation_completed_at": None,
        "last_event_at": _now_utc_iso(),
        **({"setup_pdf_status": "outdated"} if setup_pdf_status in {"ready", "outdated"} else {}),
    }
    if not preserve_graph:
        update_payload.update(
            {
                "nodes": [],
                "edges": [],
                "terraform_files": [],
                "cost_estimate": None,
                "description": None,
            }
        )

    await update_project_fields(
        project_id,
        user_id,
        update_payload,
    )
    refreshed = await get_project_for_user(project_id, user_id)
    if isinstance(project_row.get("chat_history"), list):
        refreshed["chat_history"] = project_row["chat_history"]
    return refreshed


_AGENT_OBSERVABILITY_SCHEMA: dict[str, dict[str, Any]] = {
    "requirements": {
        "label": "Requirements",
        "blocked_by": [],
    },
    "architect": {
        "label": "Architect",
        "blocked_by": ["requirements"],
    },
    "cost_analyst": {
        "label": "Cost analysis",
        "blocked_by": ["architect"],
    },
}

_AGENT_HISTORY: dict[str, dict[str, list[str]]] = {
    "requirements": {
        "running": ["Reading your app description", "Inferring the AWS services you likely need"],
        "completed": ["Requirements extracted"],
    },
    "architect": {
        "running": ["Designing your AWS architecture", "Laying out networking and compute components"],
        "completed": ["Architecture draft complete"],
    },
    "cost_analyst": {
        "running": ["Estimating monthly AWS cost", "Reviewing the architecture for major cost drivers"],
        "completed": ["Cost estimate ready"],
    },
}

_AGENT_RUNNING_SUMMARY: dict[str, str] = {
    "requirements": "Turning your app description into infrastructure requirements",
    "architect": "Designing your AWS architecture",
    "cost_analyst": "Estimating monthly AWS cost",
}

_AGENT_COMPLETED_SUMMARY: dict[str, str] = {
    "requirements": "Requirements ready",
    "architect": "Architecture ready for cost review",
    "cost_analyst": "Cost estimate ready",
}

_MAX_HISTORY: int = 3


def _init_generation_observability() -> list[dict[str, Any]]:
    agents: list[dict[str, Any]] = []
    for agent_name, schema in _AGENT_OBSERVABILITY_SCHEMA.items():
        blocked_by = list(schema["blocked_by"])
        agents.append({
            "agent": agent_name,
            "label": schema["label"],
            "status": "blocked" if blocked_by else "queued",
            "summary": (
                f"Waiting for {blocked_by[0].replace('_', ' ')}"
                if blocked_by
                else "Ready to start"
            ),
            "detail": None,
            "blocked_by": blocked_by,
            "started_at": None,
            "completed_at": None,
            "elapsed_ms": None,
            "progress_text": None,
            "history": [],
            "error": None,
        })
    return agents


def _update_generation_agent(
    agents: list[dict[str, Any]],
    agent_name: str,
    status: str,
    *,
    now_utc: str | None = None,
    error: str | None = None,
) -> None:
    for agent in agents:
        if agent["agent"] != agent_name:
            continue

        agent["status"] = status

        if status == "running":
            agent["summary"] = _AGENT_RUNNING_SUMMARY.get(agent_name, "")
            agent["started_at"] = now_utc or _now_utc_iso()
            agent["completed_at"] = None
            agent["error"] = None
            milestones = _AGENT_HISTORY.get(agent_name, {}).get("running", [])
            agent["history"] = list(milestones[:_MAX_HISTORY])
            agent["progress_text"] = milestones[0] if milestones else None

        elif status == "completed":
            agent["summary"] = _AGENT_COMPLETED_SUMMARY.get(agent_name, "")
            agent["completed_at"] = now_utc or _now_utc_iso()
            agent["progress_text"] = None
            if agent["started_at"]:
                try:
                    started = datetime.fromisoformat(agent["started_at"])
                    completed = datetime.fromisoformat(agent["completed_at"])
                    agent["elapsed_ms"] = int((completed - started).total_seconds() * 1000)
                except (ValueError, TypeError):
                    pass
            done_entries = _AGENT_HISTORY.get(agent_name, {}).get("completed", [])
            agent["history"] = agent.get("history", [])[:_MAX_HISTORY - 1] + list(done_entries[:1])

        elif status == "failed":
            agent["summary"] = "Could not finish this step"
            agent["completed_at"] = now_utc or _now_utc_iso()
            agent["progress_text"] = None
            agent["error"] = error
            if agent["started_at"]:
                try:
                    started = datetime.fromisoformat(agent["started_at"])
                    completed = datetime.fromisoformat(agent["completed_at"])
                    agent["elapsed_ms"] = int((completed - started).total_seconds() * 1000)
                except (ValueError, TypeError):
                    pass

    if status in ("completed", "failed"):
        for agent in agents:
            if agent_name in agent["blocked_by"]:
                if status == "failed":
                    agent["status"] = "blocked"
                    agent["summary"] = f"Blocked because {agent_name.replace('_', ' ')} stopped"
                else:
                    agent["status"] = "queued"
                    agent["summary"] = "Ready to start"
                    agent["blocked_by"] = []


async def _run_generation(runtime: GenerationRuntime, answers: Any) -> None:
    user_id = runtime.user_id
    project_id = runtime.project_id
    llm_creds = getattr(runtime, "llm_creds", None)
    start_time = time.time()
    best_effort_state: dict[str, Any] | None = None
    budget_retry_requirements: dict[str, Any] | None = None
    budget_retry_mode = isinstance(answers, dict) and answers.get("_budget_recovery_retry") is True
    budget_retry_context = (
        answers.get("_budget_recovery_context")
        if isinstance(answers, dict) and isinstance(answers.get("_budget_recovery_context"), dict)
        else {}
    )
    retry_budget_cap = _as_valid_number(budget_retry_context.get("budget_cap"))
    retry_estimated_total = _as_valid_number(budget_retry_context.get("estimated_total"))

    try:
        logger.info("Generation started project_id=%s trace_id=%s user_id=%s", project_id, runtime.trace_id, user_id)
        def regions_from_requirements(pass_requirements: dict[str, Any]) -> list[str]:
            raw_regions = pass_requirements.get("regions")
            if not isinstance(raw_regions, list):
                return []
            return [entry.strip() for entry in raw_regions if isinstance(entry, str) and entry.strip()]

        diagram_nodes: list[dict[str, Any]] = []

        async def run_architect_and_cost_pass(pass_requirements: dict[str, Any]) -> None:
            nonlocal diagram_nodes

            await runtime.send_text(
                json.dumps({"type": "status", "message": "Designing architecture..."})
            )
            await runtime.update_generation_agent("architect", "running")
            await runtime.emit_pipeline_event("architect", "started", "info", "architect started")
            await runtime.set_generation_state(status="running", stage="architect")

            try:
                await stream_architecture(pass_requirements, runtime, start_time, llm_creds=llm_creds)
            except Exception as error:
                await runtime.emit_pipeline_event("architect", "failed", "error", "architect failed", {"error": str(error)})
                raise

            await runtime.update_generation_agent("architect", "completed")
            await runtime.emit_pipeline_event("architect", "completed", "info", "architect completed")
            diagram_nodes = list(runtime.persistence.nodes)
            logger.info("Architect complete project_id=%s trace_id=%s nodes=%d", project_id, runtime.trace_id, len(diagram_nodes))
            if len(diagram_nodes) == 0:
                if budget_retry_mode:
                    await runtime.emit_pipeline_event(
                        "budget_cap",
                        "retry_failed",
                        "error",
                        "Budget retry produced an empty architecture output.",
                        {
                            "budget_cap": retry_budget_cap,
                            "estimated_total": retry_estimated_total,
                        },
                    )
                    raise BudgetCapUnmetError(
                        retry_budget_cap or 0.0,
                        retry_estimated_total or (retry_budget_cap or 0.0),
                    )
                raise RuntimeError("Architect returned an empty architecture output.")

            await runtime.update_generation_agent("cost_analyst", "running")
            await runtime.emit_pipeline_event("cost_analyst", "started", "info", "cost analyst started")
            await runtime.set_generation_state(status="running", stage="cost_analyst")

            cost_estimate = await run_cost_analyst(
                nodes=diagram_nodes,
                regions=regions_from_requirements(pass_requirements),
                project_id=project_id,
                runtime=runtime,
                monthly_budget=pass_requirements.get("monthly_budget"),
                budget_cap=pass_requirements.get("budget_cap"),
            )

            if isinstance(cost_estimate, dict):
                runtime.persistence.cost_estimate = cost_estimate
                await runtime.send_text(json.dumps({"type": "cost_estimate", **cost_estimate}))
                await runtime.update_generation_agent("cost_analyst", "completed")
                await runtime.emit_pipeline_event(
                    "cost_analyst",
                    "completed",
                    "info",
                    "Cost analysis completed",
                    {
                        "region": cost_estimate.get("region"),
                        "monthly_total": cost_estimate.get("monthly_total"),
                        "items": len(cost_estimate.get("items") or []),
                    },
                )
            else:
                runtime.persistence.cost_estimate = None
                await runtime.emit_pipeline_event(
                    "cost_analyst",
                    "skipped",
                    "info",
                    "Cost analysis skipped",
                )

        def snapshot_best_effort_state() -> None:
            nonlocal best_effort_state
            if not isinstance(runtime.persistence.nodes, list) or len(runtime.persistence.nodes) == 0:
                return
            best_effort_state = {
                "nodes": copy.deepcopy(runtime.persistence.nodes),
                "edges": copy.deepcopy(runtime.persistence.edges),
                "cost_estimate": copy.deepcopy(runtime.persistence.cost_estimate),
            }

        requirements: dict[str, Any]
        if budget_retry_mode:
            base_requirements = budget_retry_context.get("requirements")
            if not isinstance(base_requirements, dict) or not base_requirements:
                raise RuntimeError("Budget retry cannot start without a requirements snapshot.")
            if retry_budget_cap is None or retry_estimated_total is None:
                raise RuntimeError("Budget retry cannot start without budget context.")

            budget_retry_requirements = copy.deepcopy(base_requirements)
            requirements = _build_strict_budget_requirements(
                budget_retry_requirements,
                retry_budget_cap,
                retry_estimated_total,
                cost_estimate=runtime.persistence.cost_estimate,
            )
            await runtime.emit_pipeline_event(
                "budget_cap",
                "retry_started",
                "warning",
                "Estimated monthly cost exceeds hard budget cap; running constrained optimization pass.",
                {
                    "budget_cap": retry_budget_cap,
                    "estimated_total": retry_estimated_total,
                    "overage": round(max(retry_estimated_total - retry_budget_cap, 0.0), 2),
                },
            )
            await runtime.set_generation_state(status="running", stage="budget_retry")
            await runtime.send_text(
                json.dumps({"type": "status", "message": "Optimizing architecture to satisfy your hard monthly budget cap..."})
            )
            snapshot_best_effort_state()
            runtime.persistence.nodes = []
            runtime.persistence.edges = []
            await update_project_fields(
                project_id,
                user_id,
                {"nodes": [], "edges": [], "last_event_at": _now_utc_iso()},
            )
            await runtime.send_text(json.dumps({"type": "diagram_reset"}))
        else:
            await runtime.set_generation_state(status="running", stage="requirements")
            await runtime.init_generation_observability()
            await runtime.update_generation_agent("requirements", "running")
            await runtime.emit_pipeline_event("requirements", "started", "info", "Processing questionnaire answers")
            await runtime.send_text(json.dumps({"type": "status", "message": "Analyzing your requirements..."}))
            await emit_log(runtime, "requirements", "Processing questionnaire answers...", start_time)

            await runtime.update_generation_agent("requirements", "completed")
            requirements = await _generate_requirements_with_retry(
                runtime,
                answers,
                llm_creds=llm_creds,
                stage="requirements",
            )
            await runtime.emit_pipeline_event("requirements", "completed", "info", "Requirements extracted")
            await emit_log(runtime, "requirements", "Requirements extracted", start_time)
            logger.info("Requirements extracted project_id=%s trace_id=%s", project_id, runtime.trace_id)
            budget_retry_requirements = copy.deepcopy(requirements)

        await run_architect_and_cost_pass(requirements)
        snapshot_best_effort_state()

        if budget_retry_mode:
            final_budget_cap = _runtime_budget_cap(runtime) or retry_budget_cap
            final_estimated_total = _runtime_estimated_total(runtime)
            if (
                final_budget_cap is not None
                and final_estimated_total is not None
                and _runtime_is_over_budget(runtime)
            ):
                await runtime.emit_pipeline_event(
                    "budget_cap",
                    "retry_failed",
                    "error",
                    "Estimated monthly cost still exceeds hard budget cap after retry.",
                    {
                        "budget_cap": final_budget_cap,
                        "estimated_total": final_estimated_total,
                        "overage": round(max(final_estimated_total - final_budget_cap, 0.0), 2),
                    },
                )
                raise BudgetCapUnmetError(final_budget_cap, final_estimated_total)

            await runtime.emit_pipeline_event(
                "budget_cap",
                "retry_succeeded",
                "info",
                "Constrained optimization pass satisfied hard budget cap.",
                {
                    "budget_cap": final_budget_cap,
                    "estimated_total": final_estimated_total,
                },
            )
        else:
            initial_budget_cap = _runtime_budget_cap(runtime)
            initial_estimated_total = _runtime_estimated_total(runtime)
            if (
                initial_budget_cap is not None
                and initial_estimated_total is not None
                and _runtime_is_over_budget(runtime)
            ):
                await runtime.emit_pipeline_event(
                    "budget_cap",
                    "retry_required",
                    "warning",
                    "Estimated monthly cost exceeds hard budget cap; waiting for user Retry or Accept decision.",
                    {
                        "budget_cap": initial_budget_cap,
                        "estimated_total": initial_estimated_total,
                        "overage": round(max(initial_estimated_total - initial_budget_cap, 0.0), 2),
                    },
                )
                raise BudgetCapUnmetError(initial_budget_cap, initial_estimated_total)

        await runtime.send_text(json.dumps({"type": "done"}))

        # Generate OG thumbnail — awaited with timeout so thumbnail_url is in DB
        # before any crawler hits the share page. Failure must not block done.
        _thumb_title = requirements.get("app_name") or "Untitled"
        _thumbnail_url = None
        try:
            _thumbnail_url = await asyncio.wait_for(
                generate_and_upload_thumbnail(
                    project_id,
                    _thumb_title,
                    diagram_nodes,
                    list(runtime.persistence.edges),
                ),
                timeout=15.0,
            )
        except Exception:
            logger.warning("Thumbnail generation timed out or failed project_id=%s", project_id)
        if _thumbnail_url:
            await update_project_fields(project_id, user_id, {"thumbnail_url": _thumbnail_url})

        await runtime.emit_pipeline_event(
            "pipeline",
            "completed",
            "info",
            "Generation completed",
            {
                "nodes": len(diagram_nodes),
                "cost_estimate_ready": isinstance(runtime.persistence.cost_estimate, dict),
            },
        )
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
        logger.info("Generation completed project_id=%s trace_id=%s", project_id, runtime.trace_id)

    except Exception as error:
        if isinstance(error, BaseExceptionGroup):
            for i, sub in enumerate(error.exceptions, 1):
                logger.error(
                    "Generation sub-exception %d/%d project_id=%s trace_id=%s: %s",
                    i, len(error.exceptions), project_id, runtime.trace_id, sub,
                    exc_info=sub,
                )
        logger.error(
            "Generation failed project_id=%s trace_id=%s error=%s",
            project_id, runtime.trace_id, str(error),
            exc_info=not isinstance(error, BaseExceptionGroup),
        )
        if runtime._generation_observability:
            for agent in runtime._generation_observability:
                if agent.get("status") == "running":
                    await runtime.update_generation_agent(
                        agent["agent"], "failed", error=str(error),
                    )
                    break
        error_code = "pipeline_failed"
        budget_recovery_metadata: dict[str, Any] | None = None
        if isinstance(error, BudgetCapUnmetError):
            error_code = error.code
            overage = round(max(error.estimated_total - error.budget_cap, 0.0), 2)
            budget_recovery_metadata = {
                "status": "pending",
                "budget_cap": error.budget_cap,
                "estimated_total": error.estimated_total,
                "overage": overage,
            }
            if isinstance(budget_retry_requirements, dict) and budget_retry_requirements:
                budget_recovery_metadata["requirements"] = copy.deepcopy(budget_retry_requirements)
            if (
                _snapshot_has_nodes(best_effort_state)
                and (
                    not isinstance(runtime.persistence.nodes, list)
                    or len(runtime.persistence.nodes) == 0
                )
            ):
                restored_nodes = copy.deepcopy(best_effort_state.get("nodes") or [])
                restored_edges = copy.deepcopy(best_effort_state.get("edges") or [])
                restored_cost = copy.deepcopy(best_effort_state.get("cost_estimate"))
                if runtime.persistence.cost_estimate is not None and restored_cost is None:
                    restored_cost = copy.deepcopy(runtime.persistence.cost_estimate)
                await _emit_canvas_snapshot(
                    runtime,
                    nodes=restored_nodes,
                    edges=restored_edges,
                    cost_estimate=restored_cost if isinstance(restored_cost, dict) else None,
                )
        await runtime.persist_partial_state()
        if isinstance(error, BudgetCapUnmetError) and budget_recovery_metadata is not None:
            try:
                await append_chat_history(
                    project_id,
                    user_id,
                    "assistant",
                    build_budget_cap_recovery_assistant_message(
                        budget_cap=error.budget_cap,
                        estimated_total=error.estimated_total,
                        overage=budget_recovery_metadata["overage"],
                    ),
                    metadata={
                        "execution_mode": "chat_only",
                        "budget_recovery": budget_recovery_metadata,
                    },
                )
            except Exception:
                logger.exception(
                    "Failed to append budget recovery chat message project_id=%s trace_id=%s",
                    project_id,
                    runtime.trace_id,
                )
        await runtime.set_generation_state(status="failed", stage="failed", error=str(error), completed=True)
        await runtime.emit_pipeline_event(
            "pipeline",
            "failed",
            "error",
            "Generation failed",
            {"error": str(error), "code": error_code},
        )
        error_payload: dict[str, Any] = {"type": "error", "error": error_code, "message": str(error)}
        if isinstance(error, BudgetCapUnmetError):
            error_payload["budget_cap"] = error.budget_cap
            error_payload["estimated_total"] = error.estimated_total
            error_payload["overage"] = round(max(error.estimated_total - error.budget_cap, 0.0), 2)
            if budget_recovery_metadata is not None:
                error_payload["budget_recovery"] = budget_recovery_metadata
        await runtime.send_text(
            json.dumps(error_payload)
        )
    finally:
        async with _TASKS_LOCK:
            _RUNNING_TASKS.pop(project_id, None)
            _RUNTIMES.pop(project_id, None)


async def _generate_requirements_with_retry(
    runtime: GenerationRuntime,
    answers: Any,
    *,
    llm_creds: dict[str, Any] | None,
    stage: str,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, REQUIREMENTS_MAX_ATTEMPTS + 1):
        try:
            return await asyncio.wait_for(
                generate_requirements(
                    answers,
                    llm_creds=llm_creds,
                    trace_id=runtime.trace_id,
                ),
                timeout=REQUIREMENTS_ATTEMPT_TIMEOUT_SECONDS,
            )
        except (asyncio.TimeoutError, TimeoutError) as error:
            last_error = error
            if attempt >= REQUIREMENTS_MAX_ATTEMPTS:
                break
            logger.warning(
                "Requirements stage stalled project_id=%s trace_id=%s stage=%s attempt=%d/%d; retrying",
                runtime.project_id,
                runtime.trace_id,
                stage,
                attempt,
                REQUIREMENTS_MAX_ATTEMPTS,
            )
            await runtime.emit_pipeline_event(
                stage,
                "retrying",
                "warning",
                "Requirements stalled, retrying...",
            )
        except ValueError as error:
            last_error = error
            raise
    if isinstance(last_error, (asyncio.TimeoutError, TimeoutError)):
        raise TimeoutError("Requirements generation timed out after retry.") from last_error
    if last_error is not None:
        raise last_error
    raise TimeoutError("Requirements generation timed out after retry.")


async def start_generation_for_user(
    user_id: str,
    user_email: str,
    answers: Any,
    project_id: str | None = None,
    client_ip: str | None = None,
) -> dict[str, Any]:
    is_admin = is_admin_email(user_email)
    llm_creds: dict[str, Any] | None = None

    try:
        llm_creds = await get_user_llm_key(user_id)
    except LlmKeyDecryptError as error:
        raise GenerationStartError("llm_key_decrypt_failed", str(error)) from error
    except Exception:
        llm_creds = None

    return await _start_generation_locked(user_id, user_email, is_admin, llm_creds, answers, project_id, client_ip)


async def _start_generation_locked(
    user_id: str,
    user_email: str,
    is_admin: bool,
    llm_creds: dict[str, Any] | None,
    answers: Any,
    project_id: str | None,
    client_ip: str | None,
) -> dict[str, Any]:
    if not has_sufficient_generation_context(answers):
        raise GenerationStartError(
            "insufficient_context",
            "Not enough context to generate yet. Provide a detailed app description or approve an architecture refactor plan first.",
        )

    if not is_admin and not llm_creds:
        try:
            reservation = await check_and_reserve_quota(user_id)
        except Exception as error:
            raise GenerationStartError("quota_check_failed", "Unable to check generation quota. Please try again.") from error

        if not reservation.get("ok"):
            err = reservation.get("error", "quota_exhausted")
            if err == "profile_not_found":
                raise GenerationStartError("quota_check_failed", "Unable to check generation quota. Please try again.")
            raise GenerationStartError("quota_exhausted", "You've used all available free generations.")

    created_project = False
    project_row: dict[str, Any]
    preserve_graph = isinstance(answers, dict) and answers.get("_budget_recovery_retry") is True
    if project_id:
        project_row = await _prepare_existing_project_for_run(
            project_id,
            user_id,
            answers,
            preserve_graph=preserve_graph,
        )
    else:
        project_row = await create_project_for_generation(user_id, answers)
        project_id = str(project_row.get("id"))
        created_project = True
        await update_project_fields(
            project_id,
            user_id,
            {
                "project_mode": "default",
                "generation_status": "queued",
                "generation_stage": "queued",
                "generation_error": None,
                "generation_started_at": _now_utc_iso(),
                "generation_completed_at": None,
                "last_event_at": _now_utc_iso(),
            },
        )

    if not isinstance(project_id, str) or not project_id:
        raise GenerationStartError("generation_start_failed", "Unable to resolve project for generation.")

    trace_id = str(uuid.uuid4())
    await update_project_fields(
        project_id,
        user_id,
        {
            "project_mode": "default",
            "generation_trace_id": trace_id,
            "generation_status": "queued",
            "generation_stage": "queued",
            "generation_error": None,
            "generation_started_at": _now_utc_iso(),
            "generation_completed_at": None,
            "last_event_at": _now_utc_iso(),
        },
    )

    async with _TASKS_LOCK:
        running_task = _RUNNING_TASKS.get(project_id)
        if running_task and not running_task.done():
            raise GenerationStartError("generation_in_progress", "Generation is already running for this project.")

        runtime = GenerationRuntime(
            project_id=project_id,
            user_id=user_id,
            trace_id=trace_id,
            is_admin=is_admin,
            persistence=PersistenceState(project_id, user_id, _seed_from_project_row(project_row)),
            broadcaster=_BROADCASTER,
            llm_creds=llm_creds,
            client_ip=client_ip,
        )
        _RUNTIMES[project_id] = runtime
        task = asyncio.create_task(_run_generation(runtime, answers))
        _RUNNING_TASKS[project_id] = task

    return {
        "project_id": project_id,
        "share_slug": project_row.get("share_slug"),
        "trace_id": trace_id,
        "generation_status": "queued",
        "created_project": created_project,
    }
