"""Tests for coder-only Terraform rerun behavior (issue #199).

These tests capture the buggy behavior where `generate_terraform` enters
`rerun_project_agents_for_user` which unconditionally calls
`_generate_requirements_with_retry` before any specialist agents, even when
only the coder is needed.

The tests should PASS once the fix is implemented, but FAIL on the current
buggy codebase.
"""

import asyncio
import copy
import json
from unittest.mock import AsyncMock, patch

import pytest

import generation_service


class _FakePersistence:
    def __init__(self) -> None:
        self.nodes: list = []
        self.edges: list = []
        self.terraform_files: list = []
        self.cost_estimate: dict | None = None
        self.chat_history: list = []
        self.arch_description: dict | None = None

    def upsert_node(self, node_payload: dict) -> None:
        node_id = node_payload.get("id")
        if not isinstance(node_id, str):
            return
        for index, node in enumerate(self.nodes):
            if isinstance(node, dict) and node.get("id") == node_id:
                self.nodes[index] = node_payload
                return
        self.nodes.append(node_payload)

    def upsert_edge(self, edge_payload: dict) -> None:
        edge_id = edge_payload.get("id")
        if not isinstance(edge_id, str):
            return
        for index, edge in enumerate(self.edges):
            if isinstance(edge, dict) and edge.get("id") == edge_id:
                self.edges[index] = edge_payload
                return
        self.edges.append(edge_payload)

    def upsert_terraform_file(self, terraform_file: dict) -> None:
        filename = terraform_file.get("filename")
        for index, tf in enumerate(self.terraform_files):
            if tf.get("filename") == filename:
                self.terraform_files[index] = terraform_file
                return
        self.terraform_files.append(terraform_file)


class _FakeBroadcaster:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def broadcast(self, _project_id: str, payload: dict) -> None:
        self.messages.append(copy.deepcopy(payload))


class _CoderRerunFakeRuntime:
    """Minimal runtime for testing coder-only rerun behavior."""

    def __init__(self) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.trace_id = "trace-test-123"
        self.is_admin = True
        self.client_ip = "198.51.100.10"
        self.persistence = _FakePersistence()
        self.broadcaster = _FakeBroadcaster()
        self.pipeline_events: list[tuple] = []
        self.generation_state_updates: list[dict] = []
        self.sent_payloads: list[dict] = []
        self.persisted_snapshots: list[dict] = []
        self._generation_observability: list[dict] | None = None
        self._generation_mode: str = "initial_generation"

    def init_generation_observability(self, *, mode: str = "initial_generation") -> None:
        self._generation_observability = generation_service._init_generation_observability(mode=mode)
        self._generation_mode = mode

    async def set_generation_state(self, **kwargs) -> None:
        self.generation_state_updates.append(kwargs)

    async def emit_pipeline_event(self, *args, **kwargs) -> None:
        self.pipeline_events.append((args, kwargs))
        payload = {
            "type": "pipeline_event",
            "stage": args[0] if args else kwargs.get("stage"),
            "event": args[1] if len(args) > 1 else kwargs.get("event"),
            "level": args[2] if len(args) > 2 else kwargs.get("level"),
            "message": args[3] if len(args) > 3 else kwargs.get("message"),
            "details": kwargs.get("details"),
        }
        await self.broadcaster.broadcast(self.project_id, payload)

    async def send_text(self, payload: str) -> None:
        self.sent_payloads.append(json.loads(payload))

    async def persist_partial_state(self) -> None:
        self.persisted_snapshots.append(
            {
                "nodes": copy.deepcopy(self.persistence.nodes),
                "edges": copy.deepcopy(self.persistence.edges),
                "terraform_files": copy.deepcopy(self.persistence.terraform_files),
                "cost_estimate": copy.deepcopy(self.persistence.cost_estimate),
            }
        )

    async def emit_generation_agent_event(
        self,
        agent: str,
        status: str,
        event_type: str,
        message: str,
        *,
        history: bool = False,
        error: str | None = None,
    ) -> None:
        if not self._generation_observability:
            return

        now_utc = generation_service._now_utc_iso()
        terminal = status in ("completed", "failed", "skipped")

        for ag in self._generation_observability:
            if ag["agent"] != agent:
                continue

            ag["status"] = status
            ag["summary"] = message

            if status == "running":
                if ag["started_at"] is None:
                    ag["started_at"] = now_utc
                ag["completed_at"] = None
                ag["error"] = None
                ag["progress_text"] = message
                if history:
                    ag["history"] = ag.get("history", [])[: generation_service._MAX_HISTORY - 1] + [message]

            elif terminal:
                ag["completed_at"] = now_utc
                ag["progress_text"] = None
                ag["error"] = error
                if ag["started_at"]:
                    try:
                        started = generation_service.datetime.fromisoformat(ag["started_at"])
                        completed = generation_service.datetime.fromisoformat(ag["completed_at"])
                        ag["elapsed_ms"] = int((completed - started).total_seconds() * 1000)
                    except (ValueError, TypeError):
                        pass
                if history:
                    ag["history"] = ag.get("history", [])[: generation_service._MAX_HISTORY - 1] + [message]

            event_payload = {
                "type": "generation_agent_event",
                "agent": agent,
                "status": status,
                "event_type": event_type,
                "message": message,
                "history": history,
                "started_at": ag.get("started_at"),
                "completed_at": ag.get("completed_at"),
                "ts": now_utc,
            }
            await self.broadcaster.broadcast(self.project_id, event_payload)
            await self.broadcast_generation_observability()

            if terminal:
                for downstream in self._generation_observability:
                    if agent in downstream.get("blocked_by", []):
                        if status == "failed":
                            downstream["status"] = "blocked"
                            downstream["summary"] = f"Blocked because {agent.replace('_', ' ')} stopped"
                        else:
                            downstream["status"] = "queued"
                            downstream["summary"] = "Ready to start"
                            downstream["blocked_by"] = []
            break

    async def broadcast_generation_observability(self) -> None:
        if not self._generation_observability:
            return
        payload = {
            "type": "generation_agent_update",
            "mode": "initial_generation",
            "agents": self._generation_observability,
        }
        await self.broadcaster.broadcast(self.project_id, payload)


@pytest.fixture(autouse=True)
def _reset_generation_state():
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()
    yield
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()


@pytest.fixture(autouse=True)
def _stub_thumbnail_generation():
    with patch("generation_service.generate_and_upload_thumbnail", new=AsyncMock(return_value=None)):
        yield


@pytest.fixture(autouse=True)
def _stub_project_updates():
    with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
        yield


def _pipeline_event_details(runtime, stage: str, event: str) -> dict | None:
    for (s, e, _l, _m), kwargs in runtime.pipeline_events:
        if s == stage and e == event:
            return {"stage": s, "event": e, "details": kwargs.get("details")}
    return None


def _pipeline_event_exists(runtime, stage: str, event: str) -> bool:
    return _pipeline_event_details(runtime, stage, event) is not None


class TestCoderOnlyRerunSkipsRequirements:
    """Tests that coder-only rerun does NOT call requirements generation.

    Bug: _run_agent_rerun unconditionally calls _generate_requirements_with_retry
    even when agent_names=["coder"]. This is wrong because the questionnaire
    answers are already persisted and the coder only needs the current diagram nodes.
    """

    @pytest.mark.asyncio
    async def test_coder_only_rerun_skips_requirements_generation(self) -> None:
        """Rerunning with agent_names=['coder'] must NOT call _generate_requirements_with_retry.

        The coder agent should receive the persisted questionnaire answers directly
        without going through requirements extraction again.
        """
        requirements_gen_called = False

        async def _track_requirements_gen(*_args, **_kwargs):
            nonlocal requirements_gen_called
            requirements_gen_called = True
            return {"app_name": "Demo"}

        async def _track_coder(requirements, runtime, start_time, **kwargs):
            assert requirements == {"app_name": "Demo"}, "Coder should receive persisted answers"
            return None

        runtime = _CoderRerunFakeRuntime()
        runtime.init_generation_observability()

        with patch.object(generation_service, "_generate_requirements_with_retry", new=_track_requirements_gen):
            with patch("generation_service.stream_terraform_files", new=_track_coder):
                await generation_service._run_agent_rerun(
                    runtime=runtime,
                    answers={"app_name": "Demo"},
                    agent_names=("coder",),
                    diagram_nodes=[{"id": "vpc"}, {"id": "ecs"}],
                )

        assert not requirements_gen_called, (
            "_generate_requirements_with_retry must NOT be called for coder-only rerun. "
            "The coder should use persisted questionnaire answers directly."
        )

    @pytest.mark.asyncio
    async def test_coder_only_rerun_uses_persisted_answers(self) -> None:
        """Coder-only rerun must use persisted questionnaire answers, not re-extract them."""
        received_requirements = None
        received_diagram_nodes = None

        async def _track_coder(requirements, runtime, start_time, **kwargs):
            nonlocal received_requirements, received_diagram_nodes
            received_requirements = requirements
            received_diagram_nodes = kwargs.get("diagram_nodes")
            runtime.persistence.terraform_files.append({"filename": "main.tf", "content": "..."})
            return None

        runtime = _CoderRerunFakeRuntime()
        runtime.init_generation_observability()
        diagram_nodes_input = [{"id": "vpc"}, {"id": "ecs"}, {"id": "rds"}]

        with patch.object(generation_service, "_generate_requirements_with_retry", new=AsyncMock(return_value={"app_name": "ShouldNotBeUsed"})):
            with patch("generation_service.stream_terraform_files", new=_track_coder):
                await generation_service._run_agent_rerun(
                    runtime=runtime,
                    answers={"app_name": "PersistedApp", "description": "My persisted app"},
                    agent_names=("coder",),
                    diagram_nodes=diagram_nodes_input,
                )

        assert received_requirements == {"app_name": "PersistedApp", "description": "My persisted app"}, (
            "Coder must receive the persisted answers passed to _run_agent_rerun, "
            "not the result of _generate_requirements_with_retry"
        )
        assert received_diagram_nodes == diagram_nodes_input, (
            f"Coder must receive the current canvas diagram_nodes. "
            f"Expected {diagram_nodes_input}, got {received_diagram_nodes}"
        )

    @pytest.mark.asyncio
    async def test_coder_only_rerun_does_not_emit_requirements_stage_events(self) -> None:
        """Coder-only rerun must NOT emit 'rerun_requirements' stage events."""
        runtime = _CoderRerunFakeRuntime()
        runtime.init_generation_observability()

        async def _noop(*_args, **_kwargs):
            return None

        with patch.object(generation_service, "_generate_requirements_with_retry", new=AsyncMock(return_value={"app_name": "Demo"})):
            with patch("generation_service.stream_terraform_files", new=_noop):
                await generation_service._run_agent_rerun(
                    runtime=runtime,
                    answers={"app_name": "Demo"},
                    agent_names=("coder",),
                    diagram_nodes=[{"id": "vpc"}],
                )

        stages = [kwargs.get("stage") or args[0] for args, kwargs in runtime.pipeline_events]
        assert "rerun_requirements" not in stages, (
            "coder-only rerun must NOT emit 'rerun_requirements' stage. "
            f"Stages emitted were: {stages}"
        )



