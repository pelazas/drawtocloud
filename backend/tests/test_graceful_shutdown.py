"""Tests for graceful shutdown of active generations and WebSockets (issue 227)."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import WebSocketDisconnect

import generation_service


class _FakeWebSocket:
    def __init__(self) -> None:
        self.closed = False
        self.close_code: int | None = None
        self.close_reason: str | None = None

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed = True
        self.close_code = code
        self.close_reason = reason


class _FakePersistence:
    def __init__(self) -> None:
        self.nodes: list = []
        self.edges: list = []
        self.terraform_files: list = []
        self.cost_estimate: dict | None = None


class _FakeRuntime:
    def __init__(self) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.trace_id = "trace-test-123"
        self.is_admin = True
        self.persistence = _FakePersistence()
        self.sent_payloads: list[dict] = []
        self.persisted = False
        self._generation_observability: list[dict] | None = None

    def init_generation_observability(self, *, mode: str = "initial_generation") -> None:
        self._generation_observability = generation_service._init_generation_observability(mode=mode)

    async def send_text(self, payload: str) -> None:
        self.sent_payloads.append(__import__("json").loads(payload))

    async def persist_partial_state(self) -> None:
        self.persisted = True

    async def set_generation_state(self, **kwargs):
        return None

    async def emit_pipeline_event(self, *args, **kwargs):
        return None

    async def update_generation_agent(self, agent_name: str, status: str, *, error: str | None = None) -> None:
        if not self._generation_observability:
            return
        generation_service._update_generation_agent(
            self._generation_observability, agent_name, status, error=error
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
        pass

    async def broadcast_generation_observability(self) -> None:
        pass


@pytest.fixture(autouse=True)
def _reset_generation_state():
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()
    yield
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()


@pytest.mark.asyncio
async def test_shutdown_persists_and_cancels_running_tasks():
    """shutdown() must persist partial state and cancel all running tasks."""
    runtime = _FakeRuntime()
    runtime.persistence.nodes = [{"id": "vpc"}]

    async def slow_generation() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise

    task = asyncio.create_task(slow_generation())
    async with generation_service._TASKS_LOCK:
        generation_service._RUNNING_TASKS["project-123"] = task
        generation_service._RUNTIMES["project-123"] = runtime

    with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
        await generation_service.shutdown(timeout_seconds=5.0)

    assert runtime.persisted is True
    assert task.cancelled() or task.done()


@pytest.mark.asyncio
async def test_shutdown_with_no_running_tasks_is_noop():
    """shutdown() must be safe when there are no running tasks."""
    with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
        await generation_service.shutdown(timeout_seconds=1.0)

    assert len(generation_service._RUNNING_TASKS) == 0
    assert len(generation_service._RUNTIMES) == 0


@pytest.mark.asyncio
async def test_broadcaster_close_all_disconnects_websockets():
    """ProjectBroadcaster.close_all_connections must close every websocket."""
    broadcaster = generation_service.ProjectBroadcaster()
    ws1 = _FakeWebSocket()
    ws2 = _FakeWebSocket()
    ws3 = _FakeWebSocket()

    await broadcaster.subscribe("project-a", ws1)
    await broadcaster.subscribe("project-a", ws2)
    await broadcaster.subscribe("project-b", ws3)

    await broadcaster.close_all_connections(code=1001, reason="Server shutting down")

    assert ws1.closed is True
    assert ws1.close_code == 1001
    assert ws1.close_reason == "Server shutting down"
    assert ws2.closed is True
    assert ws3.closed is True

    async with broadcaster._lock:
        assert len(broadcaster._subscribers) == 0


@pytest.mark.asyncio
async def test_broadcaster_close_all_handles_already_closed_websockets():
    """close_all_connections must tolerate websockets that are already closed."""
    broadcaster = generation_service.ProjectBroadcaster()

    class BrokenWebSocket:
        async def close(self, code: int = 1000, reason: str | None = None) -> None:
            raise RuntimeError('Cannot call "send" once a close message has been sent.')

    ws = BrokenWebSocket()
    await broadcaster.subscribe("project-a", ws)

    await broadcaster.close_all_connections(code=1001, reason="Server shutting down")

    async with broadcaster._lock:
        assert len(broadcaster._subscribers) == 0


@pytest.mark.asyncio
async def test_generation_persists_state_on_cancellation():
    """When _run_generation is cancelled, persist_partial_state must be called."""
    import copy

    class _TrackPersistRuntime(_FakeRuntime):
        async def persist_partial_state(self) -> None:
            self.persisted = True

    runtime = _TrackPersistRuntime()
    runtime.persistence.nodes = [{"id": "vpc"}]

    async def slow_architect(_requirements, _runtime, _start_time, **_kwargs):
        await asyncio.sleep(3600)

    task = asyncio.create_task(
        generation_service._run_generation(runtime, {"app_name": "Demo"})
    )
    async with generation_service._TASKS_LOCK:
        generation_service._RUNNING_TASKS["project-123"] = task
        generation_service._RUNTIMES["project-123"] = runtime

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=slow_architect):
            with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
                        await asyncio.sleep(0.05)
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass

    assert runtime.persisted is True
    assert "project-123" not in generation_service._RUNNING_TASKS
    assert "project-123" not in generation_service._RUNTIMES
