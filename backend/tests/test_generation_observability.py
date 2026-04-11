"""Tests for event-driven generation observability."""

import asyncio
import copy
import json
from datetime import datetime, timezone
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


class _FakeBroadcaster:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def broadcast(self, _project_id: str, payload: dict) -> None:
        self.messages.append(copy.deepcopy(payload))


class _FakeRuntime:
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

    async def set_generation_state(self, **kwargs) -> None:
        self.generation_state_updates.append(kwargs)

    async def emit_pipeline_event(self, *args, **kwargs) -> None:
        self.pipeline_events.append((args, kwargs))

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


class TestEmitGenerationAgentEvent:
    """Tests for GenerationRuntime.emit_generation_agent_event()."""

    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.runtime = _FakeRuntime()
        self.runtime._generation_observability = generation_service._init_generation_observability()
        self.messages = self.runtime.broadcaster.messages

    def _get_agent(self, name: str) -> dict:
        for agent in self.runtime._generation_observability or []:
            if agent["agent"] == name:
                return agent
        raise AssertionError(f"Agent {name} not found")

    @pytest.mark.asyncio
    async def test_first_running_event_sets_started_at(self) -> None:
        """First 'running' event sets started_at timestamp."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        agent = self._get_agent("requirements")
        assert agent["started_at"] is not None
        assert agent["completed_at"] is None
        assert agent["status"] == "running"

    @pytest.mark.asyncio
    async def test_progress_text_updated_on_each_event(self) -> None:
        """Each event updates progress_text to latest message."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="parsing_output",
            message="Parsing requirements output",
        )
        agent = self._get_agent("requirements")
        assert agent["progress_text"] == "Parsing requirements output"

    @pytest.mark.asyncio
    async def test_history_appended_when_history_true(self) -> None:
        """When history=True, message is appended to history list."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
            history=True,
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="parsing_output",
            message="Parsing requirements output",
            history=True,
        )
        agent = self._get_agent("requirements")
        assert agent["history"] == [
            "Sending your requirements to the model",
            "Parsing requirements output",
        ]

    @pytest.mark.asyncio
    async def test_history_false_does_not_append(self) -> None:
        """When history=False, message updates progress_text but not history."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
            history=True,
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="parsing_output",
            message="Parsing requirements output",
            history=False,
        )
        agent = self._get_agent("requirements")
        assert agent["history"] == ["Sending your requirements to the model"]
        assert agent["progress_text"] == "Parsing requirements output"

    @pytest.mark.asyncio
    async def test_history_capped_at_max_history(self) -> None:
        """History is capped at _MAX_HISTORY entries."""
        for i in range(5):
            await self.runtime.emit_generation_agent_event(
                agent="requirements",
                status="running",
                event_type=f"event_{i}",
                message=f"Milestone {i}",
                history=True,
            )
        agent = self._get_agent("requirements")
        assert len(agent["history"]) == generation_service._MAX_HISTORY
        assert agent["history"][-1] == "Milestone 4"

    @pytest.mark.asyncio
    async def test_completed_event_sets_completed_at(self) -> None:
        """Completed event sets completed_at timestamp."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await asyncio.sleep(0.01)
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="completed",
            event_type="completed",
            message="Requirements ready",
        )
        agent = self._get_agent("requirements")
        assert agent["completed_at"] is not None
        assert agent["started_at"] is not None

    @pytest.mark.asyncio
    async def test_completed_event_computes_elapsed_ms(self) -> None:
        """Completed event computes elapsed_ms from timestamps."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await asyncio.sleep(0.02)
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="completed",
            event_type="completed",
            message="Requirements ready",
        )
        agent = self._get_agent("requirements")
        assert agent["elapsed_ms"] is not None
        assert agent["elapsed_ms"] >= 15

    @pytest.mark.asyncio
    async def test_failed_event_sets_error(self) -> None:
        """Failed event sets error field."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="failed",
            event_type="failed",
            message="Requirements extraction failed",
            error="Model returned malformed JSON",
        )
        agent = self._get_agent("requirements")
        assert agent["status"] == "failed"
        assert agent["error"] == "Model returned malformed JSON"
        assert agent["completed_at"] is not None

    @pytest.mark.asyncio
    async def test_downstream_agent_unblocked_on_completion(self) -> None:
        """When requirements completes, architect moves from blocked to queued."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="completed",
            event_type="completed",
            message="Requirements ready",
        )
        architect = self._get_agent("architect")
        assert architect["status"] == "queued"
        assert architect["blocked_by"] == []

    @pytest.mark.asyncio
    async def test_downstream_agent_blocked_on_failure(self) -> None:
        """When requirements fails, architect is marked blocked."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="failed",
            event_type="failed",
            message="Requirements extraction failed",
            error="Model returned malformed JSON",
        )
        architect = self._get_agent("architect")
        assert architect["status"] == "blocked"
        assert architect["summary"] == "Blocked because requirements stopped"

    @pytest.mark.asyncio
    async def test_broadcasts_event_message(self) -> None:
        """Emitting an event broadcasts generation_agent_event message."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
            history=True,
        )
        event_msgs = [m for m in self.messages if m.get("type") == "generation_agent_event"]
        assert len(event_msgs) == 1
        msg = event_msgs[0]
        assert msg["agent"] == "requirements"
        assert msg["status"] == "running"
        assert msg["event_type"] == "requesting_model"
        assert msg["message"] == "Sending your requirements to the model"
        assert msg["history"] is True

    @pytest.mark.asyncio
    async def test_broadcasts_update_message(self) -> None:
        """Emitting an event also broadcasts generation_agent_update snapshot."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        update_msgs = [m for m in self.messages if m.get("type") == "generation_agent_update"]
        assert len(update_msgs) >= 1
        latest = update_msgs[-1]
        assert latest["mode"] == "initial_generation"
        assert "agents" in latest
        agent_names = [a["agent"] for a in latest["agents"]]
        assert "requirements" in agent_names

    @pytest.mark.asyncio
    async def test_init_observability_sets_blocked_by(self) -> None:
        """init_generation_observability creates agents with correct blocked_by."""
        agents = generation_service._init_generation_observability()
        by_name = {a["agent"]: a for a in agents}
        assert by_name["requirements"]["blocked_by"] == []
        assert by_name["architect"]["blocked_by"] == ["requirements"]
        assert by_name["cost_analyst"]["blocked_by"] == ["architect"]

    @pytest.mark.asyncio
    async def test_terminal_status_clears_progress_text(self) -> None:
        """When status becomes completed/failed, progress_text is cleared."""
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="running",
            event_type="requesting_model",
            message="Sending your requirements to the model",
        )
        await self.runtime.emit_generation_agent_event(
            agent="requirements",
            status="completed",
            event_type="completed",
            message="Requirements ready",
        )
        agent = self._get_agent("requirements")
        assert agent["progress_text"] is None
