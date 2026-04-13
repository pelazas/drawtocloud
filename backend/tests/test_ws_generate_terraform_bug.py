"""Tests for WebSocket-level generate_terraform behavior (issue #199).

These tests capture the buggy behavior where `generate_terraform` enters
the requirements stage even though only the coder agent is needed.

The tests should PASS once the fix is implemented, but FAIL on the current
buggy codebase.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import WebSocketDisconnect


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
