"""Tests for WebSocket-level generate_terraform behavior (issue #199).

These tests capture the buggy behavior where `generate_terraform` enters
the requirements stage even though only the coder agent is needed.

The tests should PASS once the fix is implemented, but FAIL on the current
buggy codebase.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from fastapi import WebSocketDisconnect

import generation_service


def test_generate_terraform_queues_coder_only_rerun(ws_client):
    """Generate terraform must queue a coder-only rerun.

    Bug: The current implementation correctly passes agent_names=['coder'] to
    rerun_project_agents_for_user, but that function then calls
    _generate_requirements_with_retry unconditionally before the coder runs.

    This test verifies that the correct agent_names are passed at the WS level.
    The actual bug is in _run_agent_rerun which calls requirements even for coder-only runs.
    """
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "vpc"}],
        "edges": [],
        "questionnaire_answers": {"app_name": "Demo", "description": "My app"},
    }

    rerun_call_kwargs = None

    async def mock_rerun(**kwargs):
        nonlocal rerun_call_kwargs
        rerun_call_kwargs = kwargs
        return {"trace_id": "trace-123"}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", new=AsyncMock(return_value=project_row)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                with patch("ws_handler.rerun_project_agents_for_user", new=mock_rerun):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "generate_terraform",
                                    "project_id": "project-123",
                                    "access_token": "test-token",
                                }
                            )
                        )

    assert rerun_call_kwargs is not None, "rerun_project_agents_for_user should have been called"
    assert rerun_call_kwargs.get("agent_names") == ["coder"], (
        f"generate_terraform should call rerun with agent_names=['coder'], "
        f"got agent_names={rerun_call_kwargs.get('agent_names')}"
    )


@pytest.mark.asyncio
async def test_generate_terraform_should_not_call_requirements_for_coder_only():
    """Generate terraform must NOT call _generate_requirements_with_retry for coder-only runs.

    Bug: The current implementation calls _generate_requirements_with_retry
    unconditionally even for coder-only runs. This wastes time and resources
    since the questionnaire answers are already persisted.

    This test directly tests _run_agent_rerun at the generation_service level
    to verify the bug exists.
    """
    requirements_gen_called = False

    async def _track_requirements_gen(*_args, **_kwargs):
        nonlocal requirements_gen_called
        requirements_gen_called = True
        return {"app_name": "Demo"}

    async def _track_coder(*args, **kwargs):
        return None

    class _FakePersistence:
        def __init__(self):
            self.nodes = []
            self.edges = []
            self.terraform_files = []
            self.cost_estimate = None
            self.chat_history = []
            self.arch_description = None

    class _FakeBroadcaster:
        async def broadcast(self, project_id, payload):
            pass

    class _FakeRuntime:
        def __init__(self):
            self.user_id = "user-123"
            self.project_id = "project-123"
            self.trace_id = "trace-123"
            self.is_admin = True
            self.client_ip = "198.51.100.10"
            self.persistence = _FakePersistence()
            self.broadcaster = _FakeBroadcaster()
            self._generation_observability = None

        def init_generation_observability(self):
            self._generation_observability = generation_service._init_generation_observability()

        async def set_generation_state(self, **kwargs):
            pass

        async def emit_pipeline_event(self, *args, **kwargs):
            pass

        async def emit_generation_agent_event(self, agent, status, event_type, message, *, history=False, error=None):
            pass

        async def send_text(self, payload):
            pass

        async def persist_partial_state(self):
            pass

    runtime = _FakeRuntime()

    with patch.object(generation_service, "_generate_requirements_with_retry", new=_track_requirements_gen):
        with patch.object(generation_service, "stream_terraform_files", new=_track_coder):
            await generation_service._run_agent_rerun(
                runtime=runtime,
                answers={"app_name": "Demo"},
                agent_names=("coder",),
                diagram_nodes=[{"id": "vpc"}],
            )

    assert not requirements_gen_called, (
        "Bug: _generate_requirements_with_retry IS being called for coder-only run. "
        "The coder should skip requirements stage and use persisted answers directly."
    )
