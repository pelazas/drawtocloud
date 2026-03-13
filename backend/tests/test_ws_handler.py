import asyncio
import json
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
    with patch("ws_handler.verify_access_token", return_value=None):
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

    with patch("ws_handler.verify_access_token", return_value="user-123"):
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
    mock_start.assert_awaited_once_with("user-123", {"app_name": "My App"}, None)


def test_ws_start_generation_surfaces_start_errors(ws_client):
    with patch("ws_handler.verify_access_token", return_value="user-123"):
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

    with patch("ws_handler.verify_access_token", return_value="user-123"):
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


def test_ws_chat_returns_stub_reply_and_persists_history(ws_client):
    with patch("ws_handler.verify_access_token", return_value="user-123"):
        with patch("ws_handler.append_chat_history") as mock_append:
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "chat",
                    "message": "hello",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "chat_reply"
    assert "coming soon" in data["message"]
    assert mock_append.call_count == 2


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

    with patch("ws_handler.verify_access_token", return_value="user-123"):
        with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=result)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                asyncio.run(handle_websocket(websocket))

    assert websocket.send_attempts >= 1
