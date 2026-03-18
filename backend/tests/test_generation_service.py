"""Tests for generation_service._run_generation agent orchestration."""

import asyncio
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


class _FakeRuntime:
    def __init__(self) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.trace_id = "trace-test-123"
        self.is_admin = True  # skip quota increment side effects
        self.persistence = _FakePersistence()
        self.pipeline_events: list[tuple] = []
        self.generation_state_updates: list[dict] = []
        self.sent_payloads: list[dict] = []

    async def set_generation_state(self, **kwargs):
        self.generation_state_updates.append(kwargs)
        return None

    async def emit_pipeline_event(self, *args, **kwargs):
        self.pipeline_events.append((args, kwargs))
        return None

    async def send_text(self, payload: str):
        self.sent_payloads.append(json.loads(payload))
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


@pytest.fixture(autouse=True)
def _stub_thumbnail_generation():
    with patch("generation_service.generate_and_upload_thumbnail", new=AsyncMock(return_value=None)):
        yield


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


@pytest.mark.asyncio
async def test_budget_cap_absent_keeps_normal_single_pass_behavior():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _cost_analyst(_requirements, runtime, _start_time, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        runtime.persistence.cost_estimate = {"monthly_total": 250.0, "currency": "USD"}

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert specialist_calls == {"coder": 1, "cost_analyst": 1, "description": 1}
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_over_cap_retries_once_and_succeeds_when_under_cap():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}
    coder_requirements: list[dict] = []

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _coder(requirements, *_args, **_kwargs):
        specialist_calls["coder"] += 1
        coder_requirements.append(requirements)

    async def _cost_analyst(_requirements, runtime, _start_time, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        if specialist_calls["cost_analyst"] == 1:
            runtime.persistence.cost_estimate = {"budget_cap": 100.0, "monthly_total": 170.0, "over_budget": True}
        else:
            runtime.persistence.cost_estimate = {"budget_cap": 100.0, "monthly_total": 92.0, "over_budget": False}

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo", "monthly_budget": 100.0})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert specialist_calls == {"coder": 2, "cost_analyst": 2, "description": 2}
    assert len(coder_requirements) == 2
    assert coder_requirements[1].get("budget_enforcement_mode") == "strict"
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_over_cap_after_retry_emits_budget_cap_unmet_and_no_done():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _cost_analyst(_requirements, runtime, _start_time, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        runtime.persistence.cost_estimate = {"budget_cap": 120.0, "monthly_total": 160.0, "over_budget": True}

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo", "monthly_budget": 120.0})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert specialist_calls == {"coder": 2, "cost_analyst": 2, "description": 2}
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "budget_cap_unmet"
    assert "120.0" in error_payload["message"]
    assert "160.0" in error_payload["message"]


def _pipeline_event_exists(runtime: _FakeRuntime, stage: str, event: str) -> bool:
    for args, _kwargs in runtime.pipeline_events:
        if len(args) < 2:
            continue
        if args[0] == stage and args[1] == event:
            return True
    return False


def _pipeline_event_details(runtime: _FakeRuntime, stage: str, event: str) -> dict | None:
    for args, _kwargs in runtime.pipeline_events:
        if len(args) < 2:
            continue
        if args[0] == stage and args[1] == event:
            if len(args) >= 5 and isinstance(args[4], dict):
                return args[4]
            return None
    return None


@pytest.mark.asyncio
async def test_specialist_failure_does_not_fail_pipeline_and_reports_partial_summary():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _cost_analyst(*_args, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        raise RuntimeError("cost analyst failed")

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert specialist_calls["coder"] == 1
    assert specialist_calls["description"] == 1
    assert specialist_calls["cost_analyst"] >= 1
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)
    assert _pipeline_event_exists(runtime, "cost_analyst", "failed_after_retries")
    summary = _pipeline_event_details(runtime, "pipeline", "completed")
    assert isinstance(summary, dict)
    assert summary["specialists"]["coder"]["state"] == "completed"
    assert summary["specialists"]["description"]["state"] == "completed"
    assert summary["specialists"]["cost_analyst"]["state"] == "failed_after_retries"


@pytest.mark.asyncio
async def test_specialist_retries_are_independent():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _cost_analyst(*_args, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        if specialist_calls["cost_analyst"] == 1:
            raise RuntimeError("temporary error")

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=_coder):
                with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                    with patch("generation_service.run_description_agent", new=_description):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert specialist_calls == {"coder": 1, "cost_analyst": 2, "description": 1}
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)
    assert _pipeline_event_exists(runtime, "cost_analyst", "retrying")
    assert _pipeline_event_exists(runtime, "cost_analyst", "completed")


@pytest.mark.asyncio
async def test_rerun_specialist_failure_does_not_fail_whole_rerun():
    specialist_calls = {"coder": 0, "cost_analyst": 0, "description": 0}

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _cost_analyst(*_args, **_kwargs):
        specialist_calls["cost_analyst"] += 1
        raise RuntimeError("cost analyst failed")

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_terraform_files", new=_coder):
            with patch("generation_service.run_cost_analyst", new=_cost_analyst):
                with patch("generation_service.run_description_agent", new=_description):
                    with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
                        await generation_service._run_agent_rerun(
                            runtime=runtime,
                            answers={"app_name": "Demo"},
                            agent_names=("coder", "cost_analyst", "description"),
                            diagram_nodes=[{"id": "node-1"}],
                        )

    assert specialist_calls["coder"] == 1
    assert specialist_calls["description"] == 1
    assert specialist_calls["cost_analyst"] >= 1
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)
    summary = _pipeline_event_details(runtime, "rerun", "completed")
    assert isinstance(summary, dict)
    assert summary["specialists"]["cost_analyst"]["state"] == "failed_after_retries"
