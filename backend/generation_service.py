import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from agents.architect import stream_architecture
from agents.coder import stream_terraform_files
from agents.cost_analyst import run_cost_analyst
from agents.description import run_description_agent
from agents.log_helper import emit_log
from agents.requirements import generate_requirements
from project_store import create_project_for_generation, derive_project_title, get_project_for_user, update_project_fields
from quota import get_user_quota, increment_generations_used

logger = logging.getLogger(__name__)


class GenerationStartError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
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


def _is_send_after_close_error(error: Exception) -> bool:
    return isinstance(error, RuntimeError) and 'Cannot call "send" once a close message has been sent.' in str(error)


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
        persistence: PersistenceState,
        broadcaster: ProjectBroadcaster,
    ) -> None:
        self.project_id = project_id
        self.user_id = user_id
        self.trace_id = trace_id
        self.persistence = persistence
        self.broadcaster = broadcaster

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        enriched = {
            **payload,
            "trace_id": self.trace_id,
            "project_id": self.project_id,
        }
        await self.broadcaster.broadcast(self.project_id, enriched)

    def _touch_generation(self, fields: dict[str, Any]) -> None:
        update_project_fields(
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
        self._touch_generation(fields)

    async def emit_pipeline_event(
        self,
        stage: str,
        event: str,
        level: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self._touch_generation({"generation_stage": stage})
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

    async def send_text(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")
        if msg_type == "diagram_event":
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
                update_project_fields(
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
                    update_project_fields(
                        self.project_id,
                        self.user_id,
                        {
                            "nodes": self.persistence.nodes,
                            "edges": self.persistence.edges,
                            "last_event_at": _now_utc_iso(),
                        },
                    )

        if msg_type == "terraform_file":
            terraform_file = {
                "filename": data.get("filename"),
                "content": data.get("content"),
                "description": data.get("description") or "",
            }
            self.persistence.upsert_terraform_file(terraform_file)
            update_project_fields(
                self.project_id,
                self.user_id,
                {"terraform_files": self.persistence.terraform_files, "last_event_at": _now_utc_iso()},
            )

        if msg_type == "cost_estimate":
            self.persistence.cost_estimate = data.get("data")
            update_project_fields(
                self.project_id,
                self.user_id,
                {"cost_estimate": self.persistence.cost_estimate, "last_event_at": _now_utc_iso()},
            )

        if msg_type == "arch_description":
            sections = data.get("sections")
            if isinstance(sections, dict):
                self.persistence.arch_description = sections
                update_project_fields(
                    self.project_id,
                    self.user_id,
                    {"description": self.persistence.serialized_description(), "last_event_at": _now_utc_iso()},
                )

        if msg_type == "done":
            update_project_fields(
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

        if msg_type == "pipeline_event":
            stage = data.get("stage")
            update_project_fields(
                self.project_id,
                self.user_id,
                {
                    "generation_trace_id": self.trace_id,
                    "generation_stage": stage if isinstance(stage, str) else None,
                    "last_event_at": _now_utc_iso(),
                },
            )

        await self._broadcast(data)

    async def persist_partial_state(self) -> None:
        update_project_fields(
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


async def subscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.subscribe(project_id, websocket)


async def unsubscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe(project_id, websocket)


async def unsubscribe_websocket_from_all(websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe_from_all(websocket)


def append_chat_history(project_id: str, user_id: str, role: str, content: str) -> None:
    row = get_project_for_user(project_id, user_id)
    history = row.get("chat_history") if isinstance(row.get("chat_history"), list) else []
    updated = [*history, {"role": role, "content": content}]
    update_project_fields(project_id, user_id, {"chat_history": updated})


def _prepare_existing_project_for_run(project_id: str, user_id: str, answers: Any) -> dict[str, Any]:
    project_row = get_project_for_user(project_id, user_id)
    update_project_fields(
        project_id,
        user_id,
        {
            "title": derive_project_title(answers),
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
        },
    )
    refreshed = get_project_for_user(project_id, user_id)
    if isinstance(project_row.get("chat_history"), list):
        refreshed["chat_history"] = project_row["chat_history"]
    return refreshed


async def _run_generation(runtime: GenerationRuntime, answers: Any) -> None:
    user_id = runtime.user_id
    project_id = runtime.project_id
    start_time = time.time()

    try:
        await runtime.set_generation_state(status="running", stage="requirements")
        await runtime.emit_pipeline_event("requirements", "started", "info", "Processing questionnaire answers")
        await runtime.send_text(json.dumps({"type": "status", "message": "Analyzing your requirements..."}))
        await emit_log(runtime, "requirements", "Processing questionnaire answers...", start_time)

        requirements = await generate_requirements(answers)
        await runtime.emit_pipeline_event("requirements", "completed", "info", "Requirements extracted")
        await emit_log(runtime, "requirements", "Requirements extracted", start_time)

        await runtime.send_text(
            json.dumps({"type": "status", "message": "Designing architecture and generating Terraform..."})
        )
        await runtime.emit_pipeline_event("pipeline", "parallel_agents_started", "info", "Running specialist agents")
        await runtime.set_generation_state(status="running", stage="parallel_agents")

        async def run_stage(stage: str, coro: Any) -> None:
            await runtime.emit_pipeline_event(stage, "started", "info", f"{stage} started")
            try:
                await coro
            except Exception as error:
                await runtime.emit_pipeline_event(stage, "failed", "error", f"{stage} failed", {"error": str(error)})
                raise
            await runtime.emit_pipeline_event(stage, "completed", "info", f"{stage} completed")

        await asyncio.gather(
            run_stage("architect", stream_architecture(requirements, runtime, start_time)),
            run_stage("coder", stream_terraform_files(requirements, runtime, start_time)),
            run_stage("cost_analyst", run_cost_analyst(requirements, runtime, start_time)),
            run_stage("description", run_description_agent(requirements, runtime, start_time)),
        )

        await runtime.send_text(json.dumps({"type": "done"}))
        await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed")
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)

        try:
            increment_generations_used(user_id)
        except Exception:
            logger.exception("Failed to increment generations_used for user %s", user_id)

    except Exception as error:
        await runtime.persist_partial_state()
        await runtime.set_generation_state(status="failed", stage="failed", error=str(error), completed=True)
        await runtime.emit_pipeline_event("pipeline", "failed", "error", "Generation failed", {"error": str(error)})
        await runtime.send_text(
            json.dumps({"type": "error", "error": "pipeline_failed", "message": str(error)})
        )
    finally:
        async with _TASKS_LOCK:
            _RUNNING_TASKS.pop(project_id, None)
            _RUNTIMES.pop(project_id, None)


async def start_generation_for_user(
    user_id: str,
    answers: Any,
    project_id: str | None = None,
) -> dict[str, Any]:
    try:
        quota = get_user_quota(user_id)
    except Exception as error:
        raise GenerationStartError("quota_check_failed", "Unable to check generation quota. Please try again.") from error

    if quota["generations_used"] >= quota["generations_limit"]:
        raise GenerationStartError("quota_exhausted", "You've used all 5 free generations...")

    created_project = False
    project_row: dict[str, Any]
    if project_id:
        project_row = _prepare_existing_project_for_run(project_id, user_id, answers)
    else:
        project_row = create_project_for_generation(user_id, answers)
        project_id = str(project_row.get("id"))
        created_project = True
        update_project_fields(
            project_id,
            user_id,
            {
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
    update_project_fields(
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
            persistence=PersistenceState(project_id, user_id, _seed_from_project_row(project_row)),
            broadcaster=_BROADCASTER,
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
