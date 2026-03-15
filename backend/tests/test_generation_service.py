"""Tests for generation_service._run_generation agent orchestration."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import generation_service


class _FakePersistence:
    def __init__(self) -> None:
        self.nodes: list = []


class _FakeRuntime:
    def __init__(self) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.is_admin = True  # skip quota increment side effects
        self.persistence = _FakePersistence()

    async def set_generation_state(self, **kwargs):
        return None

    async def emit_pipeline_event(self, *args, **kwargs):
        return None

    async def send_text(self, payload: str):
        return None

    async def persist_partial_state(self):
        return None


@pytest.fixture(autouse=True)
def _reset_generation_state():
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()
    yield
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()


@pytest.mark.asyncio
async def test_task_group_cancels_siblings_on_failure():
    """When one agent raises, sibling agents must be cancelled (not complete).

    With asyncio.gather the siblings run to completion; with asyncio.TaskGroup
    they are cancelled as soon as the first exception propagates.  The test
    verifies the TaskGroup behaviour: the coder/cost_analyst/description agents
    must NOT reach their final completion step when the architect raises.

    Mechanism:
    - The architect coroutine raises immediately (before yielding to the event
      loop).
    - Each sibling coroutine awaits asyncio.sleep(0) — a single yield — giving
      the event loop a chance to deliver CancelledError before they mark
      themselves as completed.
    - Under asyncio.gather the siblings are NOT cancelled; they resume after
      the yield and append their name to `siblings_completed`.
    - Under asyncio.TaskGroup the siblings receive CancelledError on the yield
      and never append their name.

    The module-level agent functions are replaced with plain `async def`
    callables (not AsyncMock) so that calling them returns the coroutine
    directly — matching the real call site: `run_stage("x", agent_fn(...))`.
    """
    siblings_completed: list[str] = []

    async def _architect(*_args, **_kwargs):
        raise RuntimeError("architect failed")

    async def _coder(*_args, **_kwargs):
        await asyncio.sleep(0)
        siblings_completed.append("coder")

    async def _cost_analyst(*_args, **_kwargs):
        await asyncio.sleep(0)
        siblings_completed.append("cost_analyst")

    async def _description(*_args, **_kwargs):
        await asyncio.sleep(0)
        siblings_completed.append("description")

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            # _run_generation catches the exception internally
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    # asyncio.gather  → siblings_completed == ["coder", "cost_analyst", "description"]  (BUG)
    # asyncio.TaskGroup → siblings_completed == []  (correct behaviour)
    assert siblings_completed == [], (
        f"Sibling agents should have been cancelled but these completed: {siblings_completed}. "
        "This indicates asyncio.gather is still being used instead of asyncio.TaskGroup."
    )


@pytest.mark.asyncio
async def test_coder_receives_architect_nodes():
    """Coder (and cost_analyst, description) must be called AFTER architect completes
    and must receive a diagram_nodes kwarg containing the nodes architect produced.

    Mechanism:
    - mock stream_architecture to append a test node to runtime.persistence.nodes
    - mock stream_terraform_files to capture its keyword arguments
    - assert stream_terraform_files was called with diagram_nodes containing that node
    """
    _TEST_NODE = {
        "id": "vpc",
        "type": "container",
        "position": {"x": 0, "y": 0},
        "data": {"label": "VPC", "category": "network"},
    }

    coder_kwargs: dict = {}
    cost_analyst_kwargs: dict = {}
    description_kwargs: dict = {}

    async def _architect(requirements, runtime, start_time, **kwargs):
        # Simulate architect populating persistence.nodes
        runtime.persistence.nodes.append(_TEST_NODE)

    async def _coder(requirements, runtime, start_time, **kwargs):
        coder_kwargs.update(kwargs)

    async def _cost_analyst(requirements, runtime, start_time, **kwargs):
        cost_analyst_kwargs.update(kwargs)

    async def _description(requirements, runtime, start_time, **kwargs):
        description_kwargs.update(kwargs)

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    # All three downstream agents must have received diagram_nodes
    assert "diagram_nodes" in coder_kwargs, (
        "stream_terraform_files was not called with diagram_nodes. "
        "Architect must run first and pass its nodes to downstream agents."
    )
    assert coder_kwargs["diagram_nodes"] == [_TEST_NODE], (
        f"Expected diagram_nodes=[{_TEST_NODE!r}], got {coder_kwargs['diagram_nodes']!r}"
    )

    assert "diagram_nodes" in cost_analyst_kwargs, (
        "run_cost_analyst was not called with diagram_nodes."
    )
    assert cost_analyst_kwargs["diagram_nodes"] == [_TEST_NODE]

    assert "diagram_nodes" in description_kwargs, (
        "run_description_agent was not called with diagram_nodes."
    )
    assert description_kwargs["diagram_nodes"] == [_TEST_NODE]
