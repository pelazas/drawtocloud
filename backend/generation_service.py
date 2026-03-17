import asyncio
import json
import logging
import re
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
from admin import is_admin_email
from llm_keys import LlmKeyDecryptError, get_user_llm_key
from project_store import append_chat_message, create_project_for_generation, derive_project_title, get_project_for_user, update_project_fields
from quota import check_and_reserve_quota

logger = logging.getLogger(__name__)

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

    async def _handle_cost_estimate(self, data: dict) -> None:
        self.persistence.cost_estimate = data.get("data")
        await update_project_fields(
            self.project_id,
            self.user_id,
            {"cost_estimate": self.persistence.cost_estimate, "last_event_at": _now_utc_iso()},
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
        "cost_estimate": _handle_cost_estimate,
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

_RERUN_AGENT_ORDER = ("coder", "cost_analyst", "description")


async def subscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.subscribe(project_id, websocket)


async def unsubscribe_websocket(project_id: str, websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe(project_id, websocket)


async def unsubscribe_websocket_from_all(websocket: WebSocket) -> None:
    await _BROADCASTER.unsubscribe_from_all(websocket)


async def append_chat_history(project_id: str, user_id: str, role: str, content: str) -> None:
    """Atomically append a chat message using the append_chat_message RPC.

    Replaces the previous read-modify-write pattern (get row, append in Python,
    write back) with a single atomic DB operation so concurrent appends to the
    same project cannot produce a lost update.
    """
    await append_chat_message(project_id, user_id, {"role": role, "content": content})


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

        requirements = await generate_requirements(answers, llm_creds=llm_creds)
        await runtime.emit_pipeline_event("rerun_requirements", "completed", "info", "Rerun requirements prepared")

        if "coder" in agent_names:
            runtime.persistence.terraform_files = []
            await update_project_fields(project_id, user_id, {"terraform_files": [], "last_event_at": _now_utc_iso()})

        async def run_stage(stage: str, coro: Any) -> None:
            await runtime.emit_pipeline_event(stage, "started", "info", f"{stage} started")
            try:
                await coro
                await runtime.emit_pipeline_event(stage, "completed", "info", f"{stage} completed")
            except Exception as error:
                await runtime.emit_pipeline_event(stage, "failed", "error", f"{stage} failed", {"error": str(error)})
                raise

        async with asyncio.TaskGroup() as tg:
            if "coder" in agent_names:
                tg.create_task(
                    run_stage(
                        "coder",
                        stream_terraform_files(
                            requirements,
                            runtime,
                            start_time,
                            diagram_nodes=diagram_nodes,
                            llm_creds=llm_creds,
                        ),
                    )
                )
            if "cost_analyst" in agent_names:
                tg.create_task(
                    run_stage(
                        "cost_analyst",
                        run_cost_analyst(
                            requirements,
                            runtime,
                            start_time,
                            diagram_nodes=diagram_nodes,
                            llm_creds=llm_creds,
                        ),
                    )
                )
            if "description" in agent_names:
                tg.create_task(
                    run_stage(
                        "description",
                        run_description_agent(
                            requirements,
                            runtime,
                            start_time,
                            diagram_nodes=diagram_nodes,
                            llm_creds=llm_creds,
                        ),
                    )
                )

        await runtime.send_text(json.dumps({"type": "done"}))
        await runtime.emit_pipeline_event("rerun", "completed", "info", "Selected agents completed")
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
    await update_project_fields(
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

        requirements = await generate_requirements(answers, llm_creds=llm_creds)
        await runtime.emit_pipeline_event("requirements", "completed", "info", "Requirements extracted")
        await emit_log(runtime, "requirements", "Requirements extracted", start_time)
        logger.info("Requirements extracted project_id=%s trace_id=%s", project_id, runtime.trace_id)

        await runtime.send_text(
            json.dumps({"type": "status", "message": "Designing architecture and generating Terraform..."})
        )

        async def run_stage(stage: str, coro: Any) -> None:
            await runtime.emit_pipeline_event(stage, "started", "info", f"{stage} started")
            try:
                await coro
                await runtime.emit_pipeline_event(stage, "completed", "info", f"{stage} completed")
            except Exception as error:
                logger.error(
                    "Stage failed stage=%s project_id=%s trace_id=%s error=%s",
                    stage, project_id, runtime.trace_id, error,
                    exc_info=True,
                )
                try:
                    await runtime.emit_pipeline_event(
                        stage, "failed", "error", f"{stage} failed", {"error": str(error)}
                    )
                except Exception:
                    logger.warning("Could not emit pipeline_event for failed stage=%s", stage)

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

        async with asyncio.TaskGroup() as tg:
            tg.create_task(
                run_stage(
                    "coder",
                    stream_terraform_files(
                        requirements,
                        runtime,
                        start_time,
                        diagram_nodes=diagram_nodes,
                        llm_creds=llm_creds,
                    ),
                )
            )
            tg.create_task(
                run_stage(
                    "cost_analyst",
                    run_cost_analyst(
                        requirements,
                        runtime,
                        start_time,
                        diagram_nodes=diagram_nodes,
                        llm_creds=llm_creds,
                    ),
                )
            )
            tg.create_task(
                run_stage(
                    "description",
                    run_description_agent(
                        requirements,
                        runtime,
                        start_time,
                        diagram_nodes=diagram_nodes,
                        llm_creds=llm_creds,
                    ),
                )
            )

        logger.info("Parallel agents complete project_id=%s trace_id=%s", project_id, runtime.trace_id)
        await runtime.send_text(json.dumps({"type": "done"}))
        await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed")
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
            "Not enough context to generate yet. Use discovery mode, review the plan, and approve generation first.",
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
