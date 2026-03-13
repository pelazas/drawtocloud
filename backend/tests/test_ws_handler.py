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
    with patch("ws_handler.verify_access_token", return_value="user-123"):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "message": "hello",
                "access_token": "test-token",
            }))
            data = json.loads(ws.receive_text())
    assert data["type"] == "chat_reply"
    assert "coming soon" in data["message"]


def test_ws_canvas_edit_returns_done(ws_client):
    with patch("ws_handler.verify_access_token", return_value="user-123"):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "canvas_edit",
                "action": "remove_node",
                "id": "rds",
                "access_token": "test-token",
            }))
            data = json.loads(ws.receive_text())
            assert data == {"type": "done"}


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


def test_ws_start_generation_runs_pipeline(ws_client):
    mock_reqs = {"inferred_services": ["VPC"], "architecture_style": "simple_three_tier"}

    async def mock_architect(reqs, ws, start_time=0):
        await ws.send_text(json.dumps({
            "type": "diagram_event",
            "action": "add_node",
            "id": "vpc",
            "label": "VPC",
            "category": "network",
        }))

    async def mock_coder(reqs, ws, start_time=0):
        await ws.send_text(json.dumps({
            "type": "terraform_file",
            "filename": "main.tf",
            "content": "# tf",
            "description": "Main config",
        }))

    async def mock_cost(reqs, ws, start_time=0):
        await ws.send_text(json.dumps({
            "type": "cost_estimate",
            "data": {
                "monthly_total": 42.0,
                "currency": "USD",
                "line_items": [],
                "generated_by": "claude_estimate",
            },
        }))

    async def mock_description(reqs, ws, start_time=0):
        await ws.send_text(json.dumps({
            "type": "arch_description",
            "sections": {
                "overview": "overview",
                "key_components": "key_components",
                "tradeoffs": "tradeoffs",
                "next_steps": "next_steps",
            },
        }))

    with patch("ws_handler.verify_access_token", return_value="user-123"):
        with patch("ws_handler.generate_requirements", return_value=mock_reqs):
            with patch("ws_handler.stream_architecture", mock_architect):
                with patch("ws_handler.stream_terraform_files", mock_coder):
                    with patch("ws_handler.run_cost_analyst", mock_cost):
                        with patch("ws_handler.run_description_agent", mock_description):
                            with ws_client.websocket_connect("/ws") as ws:
                                ws.send_text(json.dumps({
                                    "type": "start_generation",
                                    "answers": {"app_type": "Web app"},
                                    "access_token": "test-token",
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
    assert "terraform_file" in types
    assert "cost_estimate" in types
    assert "arch_description" in types
    assert events[-1]["type"] == "done"
