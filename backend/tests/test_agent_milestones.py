"""Tests for agent milestone emissions in generation observability."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

import generation_service
from agents import requirements as req_agent


class _FakePersistence:
    def __init__(self) -> None:
        self.nodes: list = []
        self.edges: list = []
        self.terraform_files: list = []
        self.cost_estimate: dict | None = None
        self.chat_history: list = []
        self.arch_description: dict | None = None


class _FakeBroadcaster:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def broadcast(self, _project_id: str, payload: dict) -> None:
        self.messages.append(payload)


class _FakeRuntime:
    def __init__(self) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.trace_id = "trace-test-123"
        self.is_admin = True
        self.client_ip = "198.51.100.10"
        self.persistence = _FakePersistence()
        self.broadcaster = _FakeBroadcaster()
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
                        from datetime import datetime, timezone

                        started = datetime.fromisoformat(ag["started_at"])
                        completed = datetime.fromisoformat(ag["completed_at"])
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


class TestRequirementsAgentMilestones:
    """Tests for requirements agent milestone emissions."""

    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.runtime = _FakeRuntime()
        self.runtime.init_generation_observability()
        self.milestones: list[dict] = []
        self.llm_response: dict = {
            "app_name": "TestApp",
            "architecture_style": "simple_three_tier",
            "inferred_services": ["VPC", "EC2", "RDS"],
            "notes": "Test architecture",
        }

        def make_milestone(
            status: str,
            event_type: str,
            message: str,
            history: bool = False,
            error: str | None = None,
        ) -> None:
            self.milestones.append(
                {
                    "status": status,
                    "event_type": event_type,
                    "message": message,
                    "history": history,
                    "error": error,
                }
            )

        self.emit_milestone = make_milestone

    @pytest.mark.asyncio
    async def test_emits_requesting_model_before_llm_call(self) -> None:
        """Should emit requesting_model before sending to LLM."""
        with patch.object(req_agent, "async_complete", new=AsyncMock(return_value=json.dumps(self.llm_response))) as mock_complete:
            result = await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app"},
                emit_milestone=self.emit_milestone,
            )
            assert mock_complete.called
            requesting = [m for m in self.milestones if m["event_type"] == "requesting_model"]
            assert len(requesting) >= 1

    @pytest.mark.asyncio
    async def test_emits_parsing_output_after_llm_response(self) -> None:
        """Should emit parsing_output after LLM returns."""
        with patch.object(req_agent, "async_complete", new=AsyncMock(return_value=json.dumps(self.llm_response))):
            await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app"},
                emit_milestone=self.emit_milestone,
            )
            parsing = [m for m in self.milestones if m["event_type"] == "parsing_output"]
            assert len(parsing) >= 1

    @pytest.mark.asyncio
    async def test_emits_validating_requirements_before_validation(self) -> None:
        """Should emit validating_requirements before payload validation."""
        with patch.object(req_agent, "async_complete", new=AsyncMock(return_value=json.dumps(self.llm_response))):
            await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app"},
                emit_milestone=self.emit_milestone,
            )
            validating = [m for m in self.milestones if m["event_type"] == "validating_requirements"]
            assert len(validating) >= 1

    @pytest.mark.asyncio
    async def test_emits_applying_budget_rules_when_budget_provided(self) -> None:
        """Should emit applying_budget_rules when monthly_budget is in answers."""
        with patch.object(req_agent, "async_complete", new=AsyncMock(return_value=json.dumps(self.llm_response))):
            await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app", "monthly_budget": 100},
                emit_milestone=self.emit_milestone,
            )
            budget = [m for m in self.milestones if m["event_type"] == "applying_budget_rules"]
            assert len(budget) >= 1

    @pytest.mark.asyncio
    async def test_emits_completed_on_success(self) -> None:
        """Should emit completed with history on successful completion."""
        with patch.object(req_agent, "async_complete", new=AsyncMock(return_value=json.dumps(self.llm_response))):
            await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app"},
                emit_milestone=self.emit_milestone,
            )
            completed = [m for m in self.milestones if m["event_type"] == "completed"]
            assert len(completed) >= 1

    @pytest.mark.asyncio
    async def test_emits_repairing_output_on_parse_failure(self) -> None:
        """Should emit repairing_output when JSON parsing fails and repair is attempted."""
        invalid_json = "This is not JSON at all"
        valid_after_repair = json.dumps(self.llm_response)

        responses = [invalid_json, valid_after_repair]
        response_iter = iter(responses)

        async def fake_complete(*args, **kwargs):
            return next(response_iter)

        with patch.object(req_agent, "async_complete", new=fake_complete):
            await req_agent.generate_requirements(
                answers={"app_name": "TestApp", "description": "A test app"},
                emit_milestone=self.emit_milestone,
            )
            repairing = [m for m in self.milestones if m["event_type"] == "repairing_output"]
            assert len(repairing) >= 1

    @pytest.mark.asyncio
    async def test_emits_failed_on_invalid_output_after_repair(self) -> None:
        """Should emit failed when output remains invalid after repair attempt."""
        invalid_json = "Still not JSON"

        call_count = 0

        async def fake_complete(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return invalid_json

        with patch.object(req_agent, "async_complete", new=fake_complete):
            with pytest.raises(ValueError):
                await req_agent.generate_requirements(
                    answers={"app_name": "TestApp", "description": "A test app"},
                    emit_milestone=self.emit_milestone,
                )
            failed = [m for m in self.milestones if m["event_type"] == "failed"]
            assert len(failed) >= 1


class TestCostAnalystMilestones:
    """Tests for cost analyst milestone emissions via runtime."""

    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.runtime = _FakeRuntime()
        self.runtime.init_generation_observability()

    def _get_agent_events(self) -> list[dict]:
        return [m for m in self.runtime.broadcaster.messages if m.get("type") == "generation_agent_event"]

    @pytest.mark.asyncio
    async def test_emits_started_when_aws_credentials_absent(self) -> None:
        """Should emit started event when AWS credentials are not configured."""
        from agents import cost_analyst as ca_agent

        with patch.object(ca_agent, "_has_aws_credentials", return_value=False):
            result = await ca_agent.run_cost_analyst(
                nodes=[],
                regions=[],
                project_id="p123",
                runtime=self.runtime,
            )
            events = self._get_agent_events()
            started = [e for e in events if e.get("event_type") == "started"]
            assert len(started) >= 1

    @pytest.mark.asyncio
    async def test_emits_choosing_region(self) -> None:
        """Should emit choosing_region when resolving pricing region."""
        from agents import cost_analyst as ca_agent

        node = {"id": "vpc", "type": "container", "data": {"label": "VPC", "containerType": "vpc"}}

        with patch.object(ca_agent, "_has_aws_credentials", return_value=True):
            with patch.object(ca_agent, "_estimate_node_item", new=AsyncMock(return_value=None)):
                with patch.object(ca_agent, "detect_closest_region", new=AsyncMock(return_value="us-east-1")):
                    result = await ca_agent.run_cost_analyst(
                        nodes=[node],
                        regions=["us-east-1"],
                        project_id="p123",
                        runtime=self.runtime,
                    )
                    events = self._get_agent_events()
                    region_events = [e for e in events if e.get("event_type") == "choosing_region"]
                    assert len(region_events) >= 1

    @pytest.mark.asyncio
    async def test_emits_inventorying_services(self) -> None:
        """Should emit inventorying_services when collecting billable items."""
        from agents import cost_analyst as ca_agent

        node = {
            "id": "ecs",
            "type": "service",
            "data": {"label": "ECS", "aws_service_code": "AmazonECS", "instance_type": "t3.small"},
        }

        with patch.object(ca_agent, "_has_aws_credentials", return_value=True):
            with patch.object(ca_agent, "_estimate_node_item", new=AsyncMock(return_value={"node_id": "ecs", "label": "ECS", "cost": 50.0})):
                with patch.object(ca_agent, "detect_closest_region", new=AsyncMock(return_value="us-east-1")):
                    await ca_agent.run_cost_analyst(
                        nodes=[node],
                        regions=["us-east-1"],
                        project_id="p123",
                        runtime=self.runtime,
                    )
                    events = self._get_agent_events()
                    inventory = [e for e in events if e.get("event_type") == "inventorying_services"]
                    assert len(inventory) >= 1

    @pytest.mark.asyncio
    async def test_emits_pricing_services(self) -> None:
        """Should emit pricing_services when looking up pricing."""
        from agents import cost_analyst as ca_agent

        node = {
            "id": "ec2",
            "type": "service",
            "data": {"label": "EC2", "aws_service_code": "AmazonEC2", "instance_type": "t3.small"},
        }

        with patch.object(ca_agent, "_has_aws_credentials", return_value=True):
            with patch.object(
                ca_agent,
                "_estimate_node_item",
                new=AsyncMock(
                    return_value={
                        "node_id": "ec2",
                        "label": "EC2",
                        "cost": 50.0,
                        "instance_type": "t3.small",
                    }
                ),
            ):
                with patch.object(ca_agent, "detect_closest_region", new=AsyncMock(return_value="us-east-1")):
                    await ca_agent.run_cost_analyst(
                        nodes=[node],
                        regions=["us-east-1"],
                        project_id="p123",
                        runtime=self.runtime,
                    )
                    events = self._get_agent_events()
                    pricing = [e for e in events if e.get("event_type") == "pricing_services"]
                    assert len(pricing) >= 1

    @pytest.mark.asyncio
    async def test_emits_completed_on_success(self) -> None:
        """Should emit completed on successful cost estimation."""
        from agents import cost_analyst as ca_agent

        node = {"id": "vpc", "type": "service", "data": {"label": "VPC", "aws_service_code": "AmazonVPC"}}

        with patch.object(ca_agent, "_has_aws_credentials", return_value=True):
            with patch.object(
                ca_agent,
                "_estimate_node_item",
                new=AsyncMock(return_value={"node_id": "vpc", "label": "VPC", "cost": 0.0}),
            ):
                with patch.object(ca_agent, "detect_closest_region", new=AsyncMock(return_value="us-east-1")):
                    await ca_agent.run_cost_analyst(
                        nodes=[node],
                        regions=["us-east-1"],
                        project_id="p123",
                        runtime=self.runtime,
                    )
                    events = self._get_agent_events()
                    completed = [e for e in events if e.get("event_type") == "completed"]
                    assert len(completed) >= 1

    @pytest.mark.asyncio
    async def test_emits_calculating_totals(self) -> None:
        """Should emit calculating_totals before final totals are computed."""
        from agents import cost_analyst as ca_agent

        node = {"id": "vpc", "type": "service", "data": {"label": "VPC", "aws_service_code": "AmazonVPC"}}

        with patch.object(ca_agent, "_has_aws_credentials", return_value=True):
            with patch.object(
                ca_agent,
                "_estimate_node_item",
                new=AsyncMock(return_value={"node_id": "vpc", "label": "VPC", "cost": 0.0}),
            ):
                with patch.object(ca_agent, "detect_closest_region", new=AsyncMock(return_value="us-east-1")):
                    await ca_agent.run_cost_analyst(
                        nodes=[node],
                        regions=["us-east-1"],
                        project_id="p123",
                        runtime=self.runtime,
                    )
                    events = self._get_agent_events()
                    totals = [e for e in events if e.get("event_type") == "calculating_totals"]
                    assert len(totals) >= 1


class TestArchitectMilestones:
    """Tests for architect milestone bucketing emissions."""

    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.runtime = _FakeRuntime()
        self.runtime.init_generation_observability()
        self.milestones: list[dict] = []

        def make_milestone(
            status: str,
            event_type: str,
            message: str,
            history: bool = False,
            error: str | None = None,
        ) -> None:
            self.milestones.append(
                {
                    "status": status,
                    "event_type": event_type,
                    "message": message,
                    "history": history,
                    "error": error,
                }
            )

        self.emit_milestone = make_milestone

    @pytest.mark.asyncio
    async def test_emits_started_before_streaming(self) -> None:
        """Should emit started before architect begins streaming."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
            yield '{"action": "add_node", "id": "ec2", "label": "EC2", "category": "compute", "node_type": "service"}\n'
            yield '{"action": "add_edge", "from": "ec2", "to": "vpc", "label": "connects to"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            started = [m for m in self.milestones if m["event_type"] == "started"]
            assert len(started) >= 1

    @pytest.mark.asyncio
    async def test_emits_waiting_for_first_event(self) -> None:
        """Should emit waiting_for_first_event before first diagram event arrives."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            await asyncio.sleep(0.01)
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            waiting = [m for m in self.milestones if m["event_type"] == "waiting_for_first_event"]
            assert len(waiting) >= 1

    @pytest.mark.asyncio
    async def test_emits_network_layout_started_on_first_container(self) -> None:
        """Should emit network_layout_started when first container node appears."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            network = [m for m in self.milestones if m["event_type"] == "network_layout_started"]
            assert len(network) >= 1

    @pytest.mark.asyncio
    async def test_emits_service_layout_started_on_first_service(self) -> None:
        """Should emit service_layout_started when first service node appears."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
            yield '{"action": "add_node", "id": "ec2", "label": "EC2", "category": "compute", "node_type": "service"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            service = [m for m in self.milestones if m["event_type"] == "service_layout_started"]
            assert len(service) >= 1

    @pytest.mark.asyncio
    async def test_emits_connections_started_on_first_edge(self) -> None:
        """Should emit connections_started when first edge appears."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
            yield '{"action": "add_node", "id": "ec2", "label": "EC2", "category": "compute", "node_type": "service"}\n'
            yield '{"action": "add_edge", "from": "ec2", "to": "vpc", "label": "connects to"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            connections = [m for m in self.milestones if m["event_type"] == "connections_started"]
            assert len(connections) >= 1

    @pytest.mark.asyncio
    async def test_emits_completed_on_success(self) -> None:
        """Should emit completed when architecture is complete."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
            yield '{"action": "add_node", "id": "ec2", "label": "EC2", "category": "compute", "node_type": "service"}\n'
            yield '{"action": "add_edge", "from": "ec2", "to": "vpc", "label": "connects to"}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            completed = [m for m in self.milestones if m["event_type"] == "completed"]
            assert len(completed) >= 1

    @pytest.mark.asyncio
    async def test_does_not_emit_milestone_per_node(self) -> None:
        """Should NOT emit a milestone for every individual node - only bucketed events."""
        from agents import architect

        async def fake_stream(*args, **kwargs):
            for i in range(10):
                yield f'{{"action": "add_node", "id": "node_{i}", "label": "Node {i}", "category": "compute", "node_type": "service"}}\n'

        with patch.object(architect, "async_stream_text", new=fake_stream):
            with patch.object(architect, "emit_log", new=AsyncMock()):
                await architect.stream_architecture(
                    requirements={"app_name": "Test"},
                    websocket=type("W", (), {"send_text": AsyncMock(), "trace_id": "t123"})(),
                    start_time=0,
                    emit_milestone=self.emit_milestone,
                )
            add_node_milestones = [m for m in self.milestones if "add_node" in m["event_type"] or m["message"].startswith("Added Node")]
            assert len(add_node_milestones) == 0, "Should not emit per-node milestones"
