import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from generation_service import GenerationStartError


def test_ws_connects(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        pass


def test_ws_invalid_json(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text("not valid json")
        data = json.loads(ws.receive_text())
    assert data["type"] == "error"
    assert data["error"] == "invalid_json"


def test_ws_unknown_message_type(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "bogus"}))
        data = json.loads(ws.receive_text())
    assert data["type"] == "error"
    assert "unknown message type" in data["error"]


def test_ws_requires_access_token(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "chat", "message": "hello"}))
        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unauthenticated"


def test_ws_rejects_invalid_token(ws_client):
    with patch("ws_handler.verify_access_token_user", return_value=None):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "message": "hello",
                "access_token": "bad-token",
            }))
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "invalid_token"


def test_ws_start_generation_emits_project_ready_and_generation_started(ws_client):
    result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
        "created_project": True,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="admin@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=result)) as mock_start:
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(json.dumps({
                        "type": "start_generation",
                        "answers": {"app_name": "My App"},
                        "access_token": "test-token",
                    }))
                    project_ready = json.loads(ws.receive_text())
                    started = json.loads(ws.receive_text())

    assert project_ready == {
        "type": "project_ready",
        "project_id": "project-123",
        "share_slug": "abcd1234",
    }
    assert started["type"] == "generation_started"
    assert started["project_id"] == "project-123"
    assert started["trace_id"] == "trace-123"
    assert started["generation_status"] == "queued"
    mock_start.assert_awaited_once_with("user-123", "admin@example.com", {"app_name": "My App"}, None)


def test_ws_start_generation_surfaces_start_errors(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch(
            "ws_handler.start_generation_for_user",
            new=AsyncMock(side_effect=GenerationStartError("quota_exhausted", "No quota left")),
        ):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "start_generation",
                    "answers": {"app_name": "My App"},
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "quota_exhausted"
    assert data["message"] == "No quota left"


def test_ws_subscribe_project_returns_generation_snapshot(ws_client):
    row = {
        "id": "project-1",
        "generation_status": "running",
        "generation_stage": "architect",
        "generation_error": None,
        "generation_trace_id": "trace-1",
        "generation_started_at": "2026-03-13T10:00:00Z",
        "generation_completed_at": None,
        "last_event_at": "2026-03-13T10:00:10Z",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=row):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()) as mock_subscribe:
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(json.dumps({
                        "type": "subscribe_project",
                        "project_id": "project-1",
                        "access_token": "test-token",
                    }))
                    data = json.loads(ws.receive_text())

    assert data["type"] == "generation_snapshot"
    assert data["project_id"] == "project-1"
    assert data["generation_status"] == "running"
    assert data["generation_stage"] == "architect"
    mock_subscribe.assert_awaited_once()


def test_ws_chat_streams_reply_and_persists_history(ws_client):
    async def mock_chat_stream(message, history, project_state, selected_node_ids=None):
        assert message == "hello"
        assert isinstance(history, list)
        assert project_state["id"] == "project-123"
        assert selected_node_ids == []
        yield "Hello "
        yield "from assistant"

    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history") as mock_append:
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "hello",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        events = []
                        while True:
                            event = json.loads(ws.receive_text())
                            events.append(event)
                            if event["type"] in ("chat_reply_done", "error"):
                                break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "Hello from assistant"
    assert mock_append.call_count == 2
    mock_append.assert_any_call("project-123", "user-123", "user", "hello")
    mock_append.assert_any_call("project-123", "user-123", "assistant", "Hello from assistant")


def test_ws_chat_forwards_selected_node_ids_to_chat_agent(ws_client):
    async def mock_chat_stream(message, history, project_state, selected_node_ids=None):
        assert message == "what does this do?"
        assert isinstance(history, list)
        assert project_state["id"] == "project-123"
        assert selected_node_ids == ["alb", "rds"]
        yield "Scoped response"

    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history"):
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "what does this do?",
                            "project_id": "project-123",
                            "selected_node_ids": ["alb", "rds"],
                            "access_token": "test-token",
                        }))
                        events = []
                        while True:
                            event = json.loads(ws.receive_text())
                            events.append(event)
                            if event["type"] in ("chat_reply_done", "error"):
                                break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "Scoped response"


def test_ws_chat_requires_project_id(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "message": "hello",
                "access_token": "test-token",
            }))
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "missing_project_id"


def test_ws_chat_returns_project_not_found_for_invalid_project(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", side_effect=RuntimeError("Project not found")):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "chat",
                    "message": "hello",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "project_not_found"


def test_ws_chat_returns_not_ready_when_generation_not_completed(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "architect",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "chat",
                    "message": "hello",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "chat_not_ready"


def test_ws_chat_returns_chat_failed_when_agent_raises(ws_client):
    async def broken_chat_stream(message, history, project_state, selected_node_ids=None):
        if False:
            yield ""
        raise RuntimeError("chat exploded")

    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history") as mock_append:
                with patch("ws_handler.stream_chat_reply", broken_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "hello",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "chat_failed"
    # user message persisted, assistant message not persisted on failure
    assert mock_append.call_count == 1


def test_canvas_edit_remove_node_triggers_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
            {"id": "rds", "data": {"label": "RDS"}, "type": "default"},
        ],
        "edges": [
            {"id": "e1", "source": "vpc", "target": "rds"},
        ],
    }

    start_result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-456",
        "generation_status": "queued",
        "created_project": False,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=start_result)) as mock_start:
                    with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(json.dumps({
                                "type": "canvas_edit",
                                "action": "remove_node",
                                "id": "rds",
                                "project_id": "project-123",
                                "access_token": "test-token",
                            }))
                            data = json.loads(ws.receive_text())

    assert data["type"] == "generation_started"
    assert data["project_id"] == "project-123"

    # update_project_fields must be called with rds node removed and its edge gone
    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    updated_edges = call_args[0][2]["edges"]
    assert not any(n["id"] == "rds" for n in updated_nodes)
    assert len(updated_edges) == 0

    # start_generation_for_user must be called to trigger regen
    mock_start.assert_awaited_once()
    start_call_args = mock_start.call_args
    assert start_call_args[0][0] == "user-123"
    assert start_call_args[0][3] == "project-123"


def test_canvas_edit_add_node_triggers_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
        ],
        "edges": [],
    }

    start_result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-456",
        "generation_status": "queued",
        "created_project": False,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=start_result)) as mock_start:
                    with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(json.dumps({
                                "type": "canvas_edit",
                                "action": "add_node",
                                "label": "Redis Cache",
                                "category": "database",
                                "project_id": "project-123",
                                "access_token": "test-token",
                            }))
                            data = json.loads(ws.receive_text())

    assert data["type"] == "generation_started"

    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    assert len(updated_nodes) == 2
    new_node = next(n for n in updated_nodes if n["id"] != "vpc")
    assert new_node["data"]["label"] == "Redis Cache"
    assert new_node["data"]["category"] == "database"

    mock_start.assert_awaited_once()


def test_canvas_edit_rename_node_triggers_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
        ],
        "edges": [],
    }

    start_result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-456",
        "generation_status": "queued",
        "created_project": False,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=start_result)) as mock_start:
                    with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(json.dumps({
                                "type": "canvas_edit",
                                "action": "rename_node",
                                "id": "vpc",
                                "label": "Main VPC",
                                "project_id": "project-123",
                                "access_token": "test-token",
                            }))
                            data = json.loads(ws.receive_text())

    assert data["type"] == "generation_started"

    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    renamed = next(n for n in updated_nodes if n["id"] == "vpc")
    assert renamed["data"]["label"] == "Main VPC"

    mock_start.assert_awaited_once()


def test_canvas_edit_requires_project_id(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "canvas_edit",
                "action": "remove_node",
                "id": "vpc",
                "access_token": "test-token",
            }))
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "missing_project_id"


def test_canvas_edit_unknown_action_returns_error(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [],
        "edges": [],
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "canvas_edit",
                    "action": "teleport_node",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unknown_canvas_action"


def test_ws_start_generation_does_not_send_after_close():
    from ws_handler import handle_websocket

    class ClosingWebSocket:
        def __init__(self) -> None:
            self._received = False
            self.send_attempts = 0

        async def receive_text(self) -> str:
            if self._received:
                raise RuntimeError("client disconnected")
            self._received = True
            return json.dumps(
                {
                    "type": "start_generation",
                    "answers": {"app_name": "My App"},
                    "access_token": "test-token",
                }
            )

        async def send_text(self, payload: str) -> None:
            self.send_attempts += 1
            raise RuntimeError('Cannot call "send" once a close message has been sent.')

    websocket = ClosingWebSocket()

    result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
        "created_project": True,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=result)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                asyncio.run(handle_websocket(websocket))

    assert websocket.send_attempts >= 1
