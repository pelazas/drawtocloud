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
        self.is_admin = True
        self.client_ip = "198.51.100.10"
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
async def test_architect_failure_skips_cost_analyst():
    cost_calls = {"count": 0}

    async def _architect(*_args, **_kwargs):
        raise RuntimeError("architect failed")

    async def _cost(*_args, **_kwargs):
        cost_calls["count"] += 1
        return None

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert cost_calls["count"] == 0


@pytest.mark.asyncio
async def test_cost_analyst_receives_architect_nodes_and_regions():
    test_node = {
        "id": "vpc",
        "type": "container",
        "position": {"x": 0, "y": 0},
        "data": {"label": "VPC", "category": "network"},
    }

    captured: dict = {}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append(test_node)

    async def _cost(nodes, regions, project_id, runtime, **kwargs):
        captured["nodes"] = nodes
        captured["regions"] = regions
        captured["project_id"] = project_id
        captured["runtime"] = runtime
        captured["kwargs"] = kwargs
        return {
            "region": "eu-west-1",
            "monthly_total": 12.0,
            "items": [
                {
                    "node_id": "vpc",
                    "label": "VPC",
                    "cost": 12.0,
                    "estimated": True,
                }
            ],
        }

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo", "regions": ["eu-west-1"]})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo", "regions": ["eu-west-1"]})

    assert captured["nodes"] == [test_node]
    assert captured["regions"] == ["eu-west-1"]
    assert captured["project_id"] == runtime.project_id
    assert captured["runtime"] is runtime


@pytest.mark.asyncio
async def test_generation_emits_cost_estimate_and_done_when_available():
    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    async def _cost(*_args, **_kwargs):
        return {
            "region": "us-east-1",
            "monthly_total": 31.5,
            "items": [
                {
                    "node_id": "node-1",
                    "label": "Node 1",
                    "cost": 31.5,
                    "estimated": False,
                }
            ],
        }

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert any(payload.get("type") == "cost_estimate" for payload in runtime.sent_payloads)
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_generation_skips_cost_message_when_analyst_returns_none():
    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert not any(payload.get("type") == "cost_estimate" for payload in runtime.sent_payloads)
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_cap_absent_keeps_single_pass_behavior():
    architect_calls = {"count": 0}
    cost_calls = {"count": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        architect_calls["count"] += 1
        runtime.persistence.nodes.append({"id": f"node-{architect_calls['count']}"})

    async def _cost(*_args, **_kwargs):
        cost_calls["count"] += 1
        return {
            "region": "us-east-1",
            "monthly_total": 40.0,
            "items": [
                {
                    "node_id": "node-1",
                    "label": "Node 1",
                    "cost": 40.0,
                    "estimated": False,
                }
            ],
        }

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert architect_calls["count"] == 1
    assert cost_calls["count"] == 1
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_over_cap_retries_once_and_succeeds_when_under_cap():
    architect_requirements: list[dict] = []
    cost_calls = {"count": 0}

    async def _architect(requirements, runtime, _start_time, **_kwargs):
        architect_requirements.append(requirements)
        runtime.persistence.nodes = [{"id": f"node-{len(architect_requirements)}"}]

    async def _cost(*_args, **_kwargs):
        cost_calls["count"] += 1
        if cost_calls["count"] == 1:
            return {
                "region": "us-east-1",
                "budget_cap": 100.0,
                "monthly_total": 170.0,
                "over_budget": True,
                "items": [{"node_id": "node-1", "label": "Node 1", "cost": 170.0, "estimated": False}],
            }
        return {
            "region": "us-east-1",
            "budget_cap": 100.0,
            "monthly_total": 92.0,
            "over_budget": False,
            "items": [{"node_id": "node-2", "label": "Node 2", "cost": 92.0, "estimated": False}],
        }

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo", "monthly_budget": 100.0})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert cost_calls["count"] == 2
    assert len(architect_requirements) == 2
    assert architect_requirements[1].get("budget_enforcement_mode") == "strict"
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_over_cap_after_retry_emits_budget_cap_unmet_and_no_done():
    cost_calls = {"count": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes = [{"id": "node-1"}]

    async def _cost(*_args, **_kwargs):
        cost_calls["count"] += 1
        return {
            "region": "us-east-1",
            "budget_cap": 120.0,
            "monthly_total": 160.0,
            "over_budget": True,
            "items": [{"node_id": "node-1", "label": "Node 1", "cost": 160.0, "estimated": False}],
        }

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo", "monthly_budget": 120.0})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert cost_calls["count"] == 2
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "budget_cap_unmet"
    assert "120.0" in error_payload["message"]
    assert "160.0" in error_payload["message"]


def test_build_strict_budget_requirements_includes_overage_context():
    result = generation_service._build_strict_budget_requirements(
        requirements={"app_name": "Demo"},
        budget_cap=100.0,
        estimated_total=170.0,
    )

    assert result["monthly_budget"] == 100.0
    assert result["budget_cap"] == 100.0
    assert result["budget_current_estimated_total"] == 170.0
    assert result["budget_current_overage"] == 70.0
    assert "Current estimate is $170.00 ($70.00 over budget)" in result["budget_optimization_instruction"]


def _pipeline_event_exists(runtime: _FakeRuntime, stage: str, event: str) -> bool:
    for args, _kwargs in runtime.pipeline_events:
        if len(args) >= 2 and args[0] == stage and args[1] == event:
            return True
    return False


def _pipeline_event_details(runtime: _FakeRuntime, stage: str, event: str) -> dict | None:
    for args, _kwargs in runtime.pipeline_events:
        if len(args) >= 2 and args[0] == stage and args[1] == event:
            if len(args) >= 5 and isinstance(args[4], dict):
                return args[4]
            return None
    return None


@pytest.mark.asyncio
async def test_run_generation_retries_requirements_once_after_timeout():
    requirements_mock = AsyncMock(side_effect=[TimeoutError("stream stalled"), {"app_name": "Demo"}])

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=requirements_mock):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert requirements_mock.await_count == 2
    assert _pipeline_event_exists(runtime, "requirements", "retrying")
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_rerun_specialist_failure_does_not_fail_whole_rerun():
    specialist_calls = {"coder": 0, "description": 0}

    async def _coder(*_args, **_kwargs):
        specialist_calls["coder"] += 1

    async def _description(*_args, **_kwargs):
        specialist_calls["description"] += 1
        raise RuntimeError("description failed")

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_terraform_files", new=_coder):
            with patch("generation_service.run_description_agent", new=_description):
                with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
                    await generation_service._run_agent_rerun(
                        runtime=runtime,
                        answers={"app_name": "Demo"},
                        agent_names=("coder", "description"),
                        diagram_nodes=[{"id": "node-1"}],
                    )

    assert specialist_calls["coder"] == 1
    assert specialist_calls["description"] >= 1
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)

    summary = _pipeline_event_details(runtime, "rerun", "completed")
    assert isinstance(summary, dict)
    assert summary["specialists"]["description"]["state"] == "failed_after_retries"


@pytest.mark.asyncio
async def test_run_agent_rerun_retries_requirements_once_after_timeout():
    requirements_mock = AsyncMock(side_effect=[TimeoutError("stream stalled"), {"app_name": "Demo"}])

    async def _description(*_args, **_kwargs):
        return None

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=requirements_mock):
        with patch("generation_service.run_description_agent", new=_description):
            await generation_service._run_agent_rerun(
                runtime=runtime,
                answers={"app_name": "Demo"},
                agent_names=("description",),
                diagram_nodes=[{"id": "node-1"}],
            )

    assert requirements_mock.await_count == 2
    assert _pipeline_event_exists(runtime, "rerun_requirements", "retrying")
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)
