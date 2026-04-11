"""Tests for generation_service._run_generation agent orchestration."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import WebSocketDisconnect

import generation_service
from agents import coder as coder_agent


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
        self.persisted_snapshots: list[dict] = []
        self._generation_observability: list[dict] | None = None

    def init_generation_observability(self) -> None:
        self._generation_observability = generation_service._init_generation_observability()

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

    async def update_generation_agent(
        self,
        agent_name: str,
        status: str,
        *,
        error: str | None = None,
    ) -> None:
        if not self._generation_observability:
            return
        generation_service._update_generation_agent(
            self._generation_observability,
            agent_name,
            status,
            error=error,
        )

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
        self.persisted_snapshots.append(
            {
                "nodes": copy.deepcopy(self.persistence.nodes),
                "edges": copy.deepcopy(self.persistence.edges),
                "terraform_files": copy.deepcopy(self.persistence.terraform_files),
                "cost_estimate": copy.deepcopy(self.persistence.cost_estimate),
            }
        )
        return None


class _FakeBroadcaster:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def broadcast(self, _project_id: str, payload: dict):
        self.messages.append(payload)


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


def test_coder_specialist_budget_supports_recovery_path():
    config = generation_service._specialist_config_for("coder")
    assert int(config["max_retries"]) >= 1
    assert float(config["attempt_timeout_seconds"]) >= 390.0


def test_coder_specialist_timeout_budget_covers_inner_worst_case():
    config = generation_service._specialist_config_for("coder")
    outer_timeout = float(config["attempt_timeout_seconds"])

    inner_worst_case = max(
        coder_agent.TOOL_USE_TIMEOUT_SECONDS + coder_agent.FALLBACK_REQUEST_TIMEOUT_SECONDS,
        max(coder_agent._JSON_SINGLE_FILE_TIMEOUT_SECONDS.values()) + coder_agent.FALLBACK_REQUEST_TIMEOUT_SECONDS,
    )
    safety_margin_seconds = 30.0

    assert outer_timeout >= inner_worst_case + safety_margin_seconds


@pytest.mark.asyncio
async def test_generation_runtime_persists_container_type_from_diagram_events():
    runtime = generation_service.GenerationRuntime(
        project_id="project-123",
        user_id="user-123",
        trace_id="trace-123",
        is_admin=True,
        persistence=generation_service.PersistenceState("project-123", "user-123"),
        broadcaster=_FakeBroadcaster(),
    )

    await runtime.send_text(json.dumps({
        "type": "diagram_event",
        "action": "add_node",
        "id": "az_a",
        "label": "Availability Zone A",
        "category": "network",
        "node_type": "container",
        "container_type": "az",
        "parent_id": "vpc",
    }))

    assert runtime.persistence.nodes == [
        {
            "id": "az_a",
            "type": "container",
            "position": {"x": 0, "y": 0},
            "parentId": "vpc",
            "extent": "parent",
            "data": {"label": "Availability Zone A", "category": "network", "containerType": "az"},
        }
    ]


@pytest.mark.asyncio
async def test_emit_canvas_snapshot_replays_container_type_and_nested_parent_ids():
    runtime = _FakeRuntime()

    await generation_service._emit_canvas_snapshot(
        runtime,
        nodes=[
            {
                "id": "vpc",
                "type": "container",
                "position": {"x": 0, "y": 0},
                "style": {"width": 700, "height": 500},
                "data": {"label": "VPC", "category": "network", "containerType": "vpc"},
            },
            {
                "id": "az_a",
                "type": "container",
                "position": {"x": 40, "y": 40},
                "style": {"width": 500, "height": 400},
                "parentId": "vpc",
                "extent": "parent",
                "data": {"label": "Availability Zone A", "category": "network", "containerType": "az"},
            },
        ],
        edges=[],
        cost_estimate=None,
    )

    diagram_events = [payload for payload in runtime.sent_payloads if payload.get("type") == "diagram_event"]
    assert runtime.sent_payloads[0] == {"type": "diagram_reset"}
    assert diagram_events == [
        {
            "type": "diagram_event",
            "action": "add_node",
            "id": "vpc",
            "label": "VPC",
            "category": "network",
            "node_type": "container",
            "container_type": "vpc",
            "position": {"x": 0, "y": 0},
            "style": {"width": 700, "height": 500},
        },
        {
            "type": "diagram_event",
            "action": "add_node",
            "id": "az_a",
            "label": "Availability Zone A",
            "category": "network",
            "node_type": "container",
            "container_type": "az",
            "position": {"x": 40, "y": 40},
            "style": {"width": 500, "height": 400},
            "parent_id": "vpc",
        },
    ]


@pytest.mark.asyncio
async def test_generation_runtime_persists_region_container_type():
    """Region containers must be persisted with type=container and containerType=region."""
    runtime = generation_service.GenerationRuntime(
        project_id="project-123",
        user_id="user-123",
        trace_id="trace-123",
        is_admin=True,
        persistence=generation_service.PersistenceState("project-123", "user-123"),
        broadcaster=_FakeBroadcaster(),
    )

    await runtime.send_text(json.dumps({
        "type": "diagram_event",
        "action": "add_node",
        "id": "eu_central_1",
        "label": "EU Central 1",
        "category": "network",
        "node_type": "container",
        "container_type": "region",
    }))

    assert runtime.persistence.nodes == [
        {
            "id": "eu_central_1",
            "type": "container",
            "position": {"x": 0, "y": 0},
            "data": {"label": "EU Central 1", "category": "network", "containerType": "region"},
        }
    ]


@pytest.mark.asyncio
async def test_emit_canvas_snapshot_replays_region_containers_with_nested_children():
    """A region -> vpc hierarchy must survive snapshot replay with correct container_type and parent_id."""
    runtime = _FakeRuntime()

    await generation_service._emit_canvas_snapshot(
        runtime,
        nodes=[
            {
                "id": "eu_central_1",
                "type": "container",
                "position": {"x": 0, "y": 0},
                "style": {"width": 860, "height": 640},
                "data": {"label": "EU Central 1", "category": "network", "containerType": "region"},
            },
            {
                "id": "vpc_eu",
                "type": "container",
                "position": {"x": 40, "y": 40},
                "style": {"width": 700, "height": 500},
                "parentId": "eu_central_1",
                "extent": "parent",
                "data": {"label": "VPC EU", "category": "network", "containerType": "vpc"},
            },
            {
                "id": "az_eu_a",
                "type": "container",
                "position": {"x": 40, "y": 40},
                "style": {"width": 500, "height": 400},
                "parentId": "vpc_eu",
                "extent": "parent",
                "data": {"label": "AZ EU A", "category": "network", "containerType": "az"},
            },
        ],
        edges=[],
        cost_estimate=None,
    )

    diagram_events = [payload for payload in runtime.sent_payloads if payload.get("type") == "diagram_event"]
    # Three add_node events: region, vpc, az
    add_nodes = [e for e in diagram_events if e.get("action") == "add_node"]
    assert len(add_nodes) == 3

    # Region emitted first, with container_type "region"
    assert add_nodes[0]["id"] == "eu_central_1"
    assert add_nodes[0]["container_type"] == "region"
    assert "parent_id" not in add_nodes[0]

    # VPC is parented to region
    assert add_nodes[1]["id"] == "vpc_eu"
    assert add_nodes[1]["parent_id"] == "eu_central_1"
    assert add_nodes[1]["container_type"] == "vpc"

    # AZ is parented to VPC
    assert add_nodes[2]["id"] == "az_eu_a"
    assert add_nodes[2]["parent_id"] == "vpc_eu"
    assert add_nodes[2]["container_type"] == "az"


@pytest.mark.asyncio
async def test_emit_canvas_snapshot_replays_service_pricing_metadata_without_tagging_containers():
    runtime = _FakeRuntime()

    await generation_service._emit_canvas_snapshot(
        runtime,
        nodes=[
            {
                "id": "vpc",
                "type": "container",
                "position": {"x": 0, "y": 0},
                "data": {"label": "VPC", "category": "network", "containerType": "vpc"},
            },
            {
                "id": "alb",
                "type": "service",
                "position": {"x": 40, "y": 40},
                "parentId": "vpc",
                "data": {
                    "label": "Application Load Balancer",
                    "category": "compute",
                    "aws_service_code": "AmazonEC2",
                },
            },
        ],
        edges=[],
        cost_estimate=None,
    )

    diagram_events = [payload for payload in runtime.sent_payloads if payload.get("type") == "diagram_event"]
    assert diagram_events == [
        {
            "type": "diagram_event",
            "action": "add_node",
            "id": "vpc",
            "label": "VPC",
            "category": "network",
            "node_type": "container",
            "container_type": "vpc",
            "position": {"x": 0, "y": 0},
        },
        {
            "type": "diagram_event",
            "action": "add_node",
            "id": "alb",
            "label": "Application Load Balancer",
            "category": "compute",
            "node_type": "service",
            "position": {"x": 40, "y": 40},
            "parent_id": "vpc",
            "aws_service_code": "AmazonEC2",
        },
    ]


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
async def test_generation_fails_when_architect_produces_no_nodes_on_normal_path():
    async def _architect(_requirements, _runtime, _start_time, **_kwargs):
        return None

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "pipeline_failed"
    assert "empty architecture" in error_payload["message"].lower()


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
async def test_budget_over_cap_requires_user_decision_without_auto_retry():
    architect_calls = {"count": 0}
    cost_calls = {"count": 0}

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        architect_calls["count"] += 1
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
                    with patch("generation_service.append_chat_history", new=AsyncMock()) as mock_append_chat:
                        await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert architect_calls["count"] == 1
    assert cost_calls["count"] == 1
    assert _pipeline_event_exists(runtime, "budget_cap", "retry_required")
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "budget_cap_unmet"
    mock_append_chat.assert_awaited_once()
    append_args = mock_append_chat.await_args
    budget_recovery = append_args.kwargs["metadata"]["budget_recovery"]
    assert budget_recovery["status"] == "pending"
    assert budget_recovery["budget_cap"] == 120.0
    assert budget_recovery["estimated_total"] == 160.0
    assert isinstance(budget_recovery.get("requirements"), dict)
    assert budget_recovery["requirements"].get("app_name") == "Demo"


@pytest.mark.asyncio
async def test_budget_recovery_retry_mode_skips_requirements_and_resets_diagram():
    requirements_mock = AsyncMock(return_value={"app_name": "Should Not Run"})

    async def _architect(requirements, runtime, _start_time, **_kwargs):
        assert requirements.get("budget_enforcement_mode") == "strict"
        runtime.persistence.nodes = [{"id": "retry-node"}]
        runtime.persistence.edges = []

    async def _cost(*_args, **_kwargs):
        return {
            "region": "us-east-1",
            "budget_cap": 120.0,
            "monthly_total": 95.0,
            "over_budget": False,
            "items": [{"node_id": "retry-node", "label": "Retry Node", "cost": 95.0, "estimated": False}],
        }

    runtime = _FakeRuntime()
    runtime.persistence.nodes = [{"id": "old-node"}]
    runtime.persistence.edges = [{"id": "old-edge", "source": "old-node", "target": "old-node"}]
    runtime.persistence.cost_estimate = {"budget_cap": 120.0, "monthly_total": 160.0, "over_budget": True, "items": []}

    retry_answers = {
        "_budget_recovery_retry": True,
        "_budget_recovery_context": {
            "budget_cap": 120.0,
            "estimated_total": 160.0,
            "requirements": {"app_name": "Demo", "regions": ["us-east-1"]},
        },
    }

    with patch("generation_service.generate_requirements", new=requirements_mock):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, retry_answers)

    assert requirements_mock.await_count == 0
    assert any(payload.get("type") == "diagram_reset" for payload in runtime.sent_payloads)
    assert any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert not any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_budget_recovery_retry_over_cap_emits_budget_cap_unmet_and_no_done():
    cost_calls = {"count": 0}

    async def _architect(requirements, runtime, _start_time, **_kwargs):
        assert requirements.get("budget_enforcement_mode") == "strict"
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
    runtime.persistence.nodes = [{"id": "old-node"}]
    runtime.persistence.edges = [{"id": "old-edge", "source": "old-node", "target": "old-node"}]
    runtime.persistence.cost_estimate = {"budget_cap": 120.0, "monthly_total": 160.0, "over_budget": True, "items": []}

    retry_answers = {
        "_budget_recovery_retry": True,
        "_budget_recovery_context": {
            "budget_cap": 120.0,
            "estimated_total": 160.0,
            "requirements": {"app_name": "Demo", "regions": ["us-east-1"]},
        },
    }

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Should Not Run"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    with patch("generation_service.append_chat_history", new=AsyncMock()) as mock_append_chat:
                        await generation_service._run_generation(runtime, retry_answers)

    assert cost_calls["count"] == 1
    assert _pipeline_event_exists(runtime, "budget_cap", "retry_failed")
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "budget_cap_unmet"
    assert "120.0" in error_payload["message"]
    assert "160.0" in error_payload["message"]
    assert error_payload["budget_cap"] == 120.0
    assert error_payload["estimated_total"] == 160.0
    assert error_payload["overage"] == 40.0
    mock_append_chat.assert_awaited_once()
    append_args = mock_append_chat.await_args
    assert append_args.args[0] == "project-123"
    assert append_args.args[1] == "user-123"
    assert append_args.args[2] == "assistant"
    assert "Reply with \"retry\"" in append_args.args[3]
    assert append_args.kwargs["metadata"]["execution_mode"] == "chat_only"
    assert append_args.kwargs["metadata"]["budget_recovery"]["status"] == "pending"
    assert append_args.kwargs["metadata"]["budget_recovery"]["budget_cap"] == 120.0
    assert append_args.kwargs["metadata"]["budget_recovery"]["estimated_total"] == 160.0
    assert isinstance(append_args.kwargs["metadata"]["budget_recovery"].get("requirements"), dict)


@pytest.mark.asyncio
async def test_budget_recovery_retry_restores_previous_canvas_when_retry_architecture_is_empty():
    previous_nodes = [{"id": "node-1", "type": "service", "data": {"label": "Old Node", "category": "compute"}}]
    previous_edges = [{"id": "edge-1", "source": "node-1", "target": "node-1", "label": "self"}]

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes = []
        runtime.persistence.edges = []

    async def _cost(*_args, **_kwargs):
        return {
            "region": "us-east-1",
            "budget_cap": 120.0,
            "monthly_total": 160.0,
            "over_budget": True,
            "items": [{"node_id": "node-1", "label": "Node 1", "cost": 160.0, "estimated": False}],
        }

    runtime = _FakeRuntime()
    runtime.persistence.nodes = copy.deepcopy(previous_nodes)
    runtime.persistence.edges = copy.deepcopy(previous_edges)
    runtime.persistence.cost_estimate = {
        "region": "us-east-1",
        "budget_cap": 120.0,
        "monthly_total": 160.0,
        "over_budget": True,
        "items": [{"node_id": "node-1", "label": "Old Node", "cost": 160.0, "estimated": False}],
    }

    retry_answers = {
        "_budget_recovery_retry": True,
        "_budget_recovery_context": {
            "budget_cap": 120.0,
            "estimated_total": 160.0,
            "requirements": {"app_name": "Demo", "regions": ["us-east-1"]},
        },
    }

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Should Not Run"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.update_project_fields", new=AsyncMock(return_value=None)):
                    with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                        await generation_service._run_generation(runtime, retry_answers)

    assert sum(1 for payload in runtime.sent_payloads if payload.get("type") == "diagram_reset") >= 2
    assert any(
        payload.get("type") == "diagram_event"
        and payload.get("action") == "add_node"
        and payload.get("id") == "node-1"
        for payload in runtime.sent_payloads
    )
    assert runtime.persisted_snapshots
    persisted = runtime.persisted_snapshots[-1]
    assert persisted["nodes"] == previous_nodes
    assert persisted["edges"] == previous_edges


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


def test_build_strict_budget_requirements_includes_cost_feedback():
    result = generation_service._build_strict_budget_requirements(
        requirements={"app_name": "Demo"},
        budget_cap=100.0,
        estimated_total=170.0,
        cost_estimate={
            "items": [
                {"label": "App Server", "cost": 90.0, "instance_type": "t3.large"},
                {"label": "RDS", "cost": 80.0, "instance_type": "db.t3.medium"},
            ]
        },
    )

    feedback = result.get("budget_cost_feedback")
    assert isinstance(feedback, list)
    assert len(feedback) == 2
    assert "App Server" in feedback[0]
    assert "$90.00" in feedback[0]
    assert "t3.large" in feedback[0]


@pytest.mark.asyncio
async def test_budget_recovery_retry_mode_uses_strict_requirements():
    captured_requirements: list[dict] = []

    async def _architect(requirements, runtime, _start_time, **_kwargs):
        captured_requirements.append(copy.deepcopy(requirements))
        runtime.persistence.nodes = [{"id": "retry-node"}]
        runtime.persistence.edges = []

    async def _cost(*_args, **_kwargs):
        return {
            "region": "us-east-1",
            "budget_cap": 90.0,
            "monthly_total": 80.0,
            "over_budget": False,
            "items": [{"node_id": "retry-node", "label": "Retry Node", "cost": 80.0, "estimated": False}],
        }

    runtime = _FakeRuntime()
    retry_answers = {
        "_budget_recovery_retry": True,
        "_budget_recovery_context": {
            "budget_cap": 90.0,
            "estimated_total": 140.0,
            "requirements": {"app_name": "Demo", "regions": ["us-east-1"]},
        },
    }

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Should Not Run"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=_cost):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, retry_answers)

    assert len(captured_requirements) == 1
    strict_requirements = captured_requirements[0]
    assert strict_requirements["budget_enforcement_mode"] == "strict"
    assert strict_requirements["budget_cap"] == 90.0
    assert strict_requirements["monthly_budget"] == 90.0
    assert strict_requirements["budget_current_estimated_total"] == 140.0


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
async def test_run_generation_retries_requirements_once_after_parse_failure():
    requirements_mock = AsyncMock(
        side_effect=[ValueError("Requirements agent returned invalid JSON: top-level JSON must be an object"), {"app_name": "Demo"}]
    )

    async def _architect(_requirements, runtime, _start_time, **_kwargs):
        runtime.persistence.nodes.append({"id": "node-1"})

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=requirements_mock):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert requirements_mock.await_count == 1
    assert not _pipeline_event_exists(runtime, "requirements", "retrying")
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_rerun_specialist_failure_surfaces_error_and_skips_done():
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
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    error_payload = next(payload for payload in runtime.sent_payloads if payload.get("type") == "error")
    assert error_payload["error"] == "rerun_failed"
    assert "Specialist rerun failed for: description" in error_payload["message"]

    failed_event = _pipeline_event_details(runtime, "rerun", "failed")
    assert isinstance(failed_event, dict)
    assert "Specialist rerun failed for: description" in str(failed_event.get("error"))


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


@pytest.mark.asyncio
async def test_run_agent_rerun_retries_requirements_once_after_parse_failure():
    requirements_mock = AsyncMock(
        side_effect=[ValueError("Requirements agent returned invalid JSON: top-level JSON must be an object"), {"app_name": "Demo"}]
    )

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

    assert requirements_mock.await_count == 1
    assert not _pipeline_event_exists(runtime, "rerun_requirements", "retrying")
    assert not any(payload.get("type") == "done" for payload in runtime.sent_payloads)
    assert any(payload.get("type") == "error" for payload in runtime.sent_payloads)


@pytest.mark.asyncio
async def test_generation_skips_cost_analyst_when_architect_produces_no_nodes():
    cost_mock = AsyncMock(return_value=None)

    async def _architect(_requirements, _runtime, _start_time, **_kwargs):
        return None

    runtime = _FakeRuntime()

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={"app_name": "Demo"})):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.run_cost_analyst", new=cost_mock):
                with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                    await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert cost_mock.await_count == 0


@pytest.mark.asyncio
async def test_send_ping_to_all_unsubscribes_closed_websockets():
    class _ClosedSocket:
        async def send_text(self, _payload: str):
            raise WebSocketDisconnect()

    broadcaster = generation_service.ProjectBroadcaster()
    closed_socket = _ClosedSocket()
    project_id = "project-1"

    await broadcaster.subscribe(project_id, closed_socket)
    await broadcaster.send_ping_to_all()

    async with broadcaster._lock:
        assert project_id not in broadcaster._subscribers


@pytest.mark.asyncio
async def test_send_ping_to_all_handles_connection_reset_errors():
    class _ResetSocket:
        async def send_text(self, _payload: str):
            raise ConnectionResetError("socket closed")

    broadcaster = generation_service.ProjectBroadcaster()
    reset_socket = _ResetSocket()
    project_id = "project-2"

    await broadcaster.subscribe(project_id, reset_socket)
    await broadcaster.send_ping_to_all()

    async with broadcaster._lock:
        assert project_id not in broadcaster._subscribers
