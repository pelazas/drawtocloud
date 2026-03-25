import asyncio
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from agents.architect import stream_architecture
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


def _build_strict_budget_requirements(requirements: dict[str, Any], budget_cap: float, estimated_total: float) -> dict[str, Any]:
    overage = round(max(estimated_total - budget_cap, 0.0), 2)
    return {
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


_SPECIALIST_HEARTBEAT_SECONDS = 8.0
_SPECIALIST_RETRY_CONFIG: dict[str, dict[str, float | int]] = {
    "coder": {
        "max_retries": 1,
        "backoff_ms": 200,
        "attempt_timeout_seconds": 220,
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
    ) -> None:
        self.project_id = project_id
        self.user_id = user_id
        self.trace_id = trace_id
        self.is_admin = is_admin
        self.persistence = persistence
        self.broadcaster = broadcaster
        self.llm_creds = llm_creds

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
            node = {
                "id": data.get("id"),
                "type": "container" if data.get("node_type") == "container" else "service",
                "position": {"x": 0, "y": 0},
                "data": {"label": data.get("label"), "category": data.get("category")},
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
                    "id": f"{source}-{target}",
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
            {"terraform_files": self.persistence.terraform_files, "last_event_at": _now_utc_iso()},
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


_BROADCASTER = ProjectBroadcaster()
_RUNNING_TASKS: dict[str, asyncio.Task[None]] = {}
_RUNTIMES: dict[str, GenerationRuntime] = {}
_TASKS_LOCK = asyncio.Lock()

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


async def _prepare_existing_project_for_run(project_id: str, user_id: str, answers: Any) -> dict[str, Any]:
    project_row = await get_project_for_user(project_id, user_id)
    setup_pdf_status = project_row.get("setup_pdf_status")
    await update_project_fields(
        project_id,
        user_id,
        {
            "title": derive_project_title(answers),
            "project_mode": "default",
            "questionnaire_answers": answers if isinstance(answers, dict) else {},
            "nodes": [],
            "edges": [],
            "terraform_files": [],
            "cost_estimate": None,
            "description": None,
            "generation_status": "queued",
            "generation_stage": "queued",
            "generation_error": None,
            "generation_started_at": _now_utc_iso(),
            "generation_completed_at": None,
            "last_event_at": _now_utc_iso(),
            **({"setup_pdf_status": "outdated"} if setup_pdf_status in {"ready", "outdated"} else {}),
        },
    )
    refreshed = await get_project_for_user(project_id, user_id)
    if isinstance(project_row.get("chat_history"), list):
        refreshed["chat_history"] = project_row["chat_history"]
    return refreshed


async def _run_generation(runtime: GenerationRuntime, answers: Any) -> None:
    user_id = runtime.user_id
    project_id = runtime.project_id
    is_admin = runtime.is_admin
    llm_creds = getattr(runtime, "llm_creds", None)
    start_time = time.time()

    try:
        logger.info("Generation started project_id=%s trace_id=%s user_id=%s", project_id, runtime.trace_id, user_id)
        await runtime.set_generation_state(status="running", stage="requirements")
        await runtime.emit_pipeline_event("requirements", "started", "info", "Processing questionnaire answers")
        await runtime.send_text(json.dumps({"type": "status", "message": "Analyzing your requirements..."}))
        await emit_log(runtime, "requirements", "Processing questionnaire answers...", start_time)

        requirements = await _generate_requirements_with_retry(
            runtime,
            answers,
            llm_creds=llm_creds,
            stage="requirements",
        )
        await runtime.emit_pipeline_event("requirements", "completed", "info", "Requirements extracted")
        await emit_log(runtime, "requirements", "Requirements extracted", start_time)
        logger.info("Requirements extracted project_id=%s trace_id=%s", project_id, runtime.trace_id)

        await runtime.send_text(
            json.dumps({"type": "status", "message": "Designing architecture..."})
        )

        async def run_specialist_pass(pass_requirements: dict[str, Any]) -> dict[str, Any]:
            specialist_factories: dict[str, Callable[[], Awaitable[None]]] = {
                "description": lambda: run_description_agent(
                    pass_requirements,
                    runtime,
                    start_time,
                    diagram_nodes=diagram_nodes,
                    llm_creds=llm_creds,
                ),
            }
            return await _run_specialists_with_retries(runtime, specialist_factories)

        # Run architect first so downstream agents have access to the diagram nodes
        await runtime.emit_pipeline_event("architect", "started", "info", "architect started")
        await runtime.set_generation_state(status="running", stage="architect")
        try:
            await stream_architecture(requirements, runtime, start_time, llm_creds=llm_creds)
        except Exception as error:
            await runtime.emit_pipeline_event("architect", "failed", "error", "architect failed", {"error": str(error)})
            raise
        await runtime.emit_pipeline_event("architect", "completed", "info", "architect completed")

        # Capture nodes produced by architect before starting parallel agents
        diagram_nodes = list(runtime.persistence.nodes)
        logger.info("Architect complete project_id=%s trace_id=%s nodes=%d", project_id, runtime.trace_id, len(diagram_nodes))

        # Run remaining agents in parallel with architect context
        await runtime.emit_pipeline_event("pipeline", "parallel_agents_started", "info", "Running specialist agents")
        await runtime.set_generation_state(status="running", stage="parallel_agents")
        specialist_summary = await run_specialist_pass(requirements)

        logger.info(
            "Parallel agents reached terminal states project_id=%s trace_id=%s summary=%s",
            project_id,
            runtime.trace_id,
            specialist_summary,
        )

        initial_budget_cap = _runtime_budget_cap(runtime)
        initial_estimated_total = _runtime_estimated_total(runtime)
        if (
            initial_budget_cap is not None
            and initial_estimated_total is not None
            and _runtime_is_over_budget(runtime)
        ):
            await runtime.emit_pipeline_event(
                "budget_cap",
                "retry_started",
                "warning",
                "Estimated monthly cost exceeds hard budget cap; running constrained optimization pass.",
                {
                    "budget_cap": initial_budget_cap,
                    "estimated_total": initial_estimated_total,
                    "overage": round(max(initial_estimated_total - initial_budget_cap, 0.0), 2),
                },
            )
            await runtime.set_generation_state(status="running", stage="budget_retry")
            await runtime.send_text(
                json.dumps({"type": "status", "message": "Optimizing architecture to satisfy your hard monthly budget cap..."})
            )

            strict_requirements = _build_strict_budget_requirements(
                requirements,
                initial_budget_cap,
                initial_estimated_total,
            )

            runtime.persistence.terraform_files = []
            specialist_summary = await run_specialist_pass(strict_requirements)

            final_budget_cap = _runtime_budget_cap(runtime) or initial_budget_cap
            final_estimated_total = _runtime_estimated_total(runtime)
            if (
                final_estimated_total is not None
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

        await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed", specialist_summary)
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
        error_code = "pipeline_failed"
        if isinstance(error, BudgetCapUnmetError):
            error_code = error.code
        await runtime.persist_partial_state()
        await runtime.set_generation_state(status="failed", stage="failed", error=str(error), completed=True)
        await runtime.emit_pipeline_event(
            "pipeline",
            "failed",
            "error",
            "Generation failed",
            {"error": str(error), "code": error_code},
        )
        await runtime.send_text(
            json.dumps({"type": "error", "error": error_code, "message": str(error)})
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
    raise TimeoutError("Requirements generation timed out after retry.") from last_error


async def start_generation_for_user(
    user_id: str,
    user_email: str,
    answers: Any,
    project_id: str | None = None,
) -> dict[str, Any]:
    is_admin = is_admin_email(user_email)
    llm_creds: dict[str, Any] | None = None

    try:
        llm_creds = await get_user_llm_key(user_id)
    except LlmKeyDecryptError as error:
        raise GenerationStartError("llm_key_decrypt_failed", str(error)) from error
    except Exception:
        llm_creds = None

    return await _start_generation_locked(user_id, user_email, is_admin, llm_creds, answers, project_id)


async def _start_generation_locked(
    user_id: str,
    user_email: str,
    is_admin: bool,
    llm_creds: dict[str, Any] | None,
    answers: Any,
    project_id: str | None,
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
    if project_id:
        project_row = await _prepare_existing_project_for_run(project_id, user_id, answers)
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
