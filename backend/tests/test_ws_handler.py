import json
from unittest.mock import patch


def test_ws_connects(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        pass  # connection accepted without error


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


def test_ws_chat_returns_stub_reply(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "chat", "message": "hello"}))
        data = json.loads(ws.receive_text())
    assert data["type"] == "chat_reply"
    assert "coming soon" in data["message"]


def test_ws_canvas_edit_returns_done(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "canvas_edit", "action": "remove_node", "id": "rds"}))
        data = json.loads(ws.receive_text())
        assert data == {"type": "done"}


def test_ws_start_generation_runs_pipeline(ws_client):
    mock_reqs = {"inferred_services": ["VPC"], "architecture_style": "simple_three_tier"}

    async def mock_stream(reqs, ws):
        await ws.send_text(json.dumps({
            "type": "diagram_event",
            "action": "add_node",
            "id": "vpc",
            "label": "VPC",
            "category": "network",
        }))

    with patch("ws_handler.generate_requirements", return_value=mock_reqs):
        with patch("ws_handler.stream_architecture", mock_stream):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "start_generation",
                    "answers": {"app_type": "Web app"},
                }))
                events = []
                while True:
                    data = json.loads(ws.receive_text())
                    events.append(data)
                    if data["type"] in ("done", "error"):
                        break

    types = [e["type"] for e in events]
    assert "status" in types
    assert "diagram_event" in types
    assert events[-1]["type"] == "done"
