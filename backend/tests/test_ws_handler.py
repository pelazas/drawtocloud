import json


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


def test_ws_chat_streams_diagram_events(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "chat", "message": "build me a web app"}))

        events = []
        while True:
            data = json.loads(ws.receive_text())
            events.append(data)
            if data["type"] == "done":
                break

        diagram_events = [e for e in events if e["type"] == "diagram_event"]
        assert len(diagram_events) > 0

        done_events = [e for e in events if e["type"] == "done"]
        assert len(done_events) == 1


def test_ws_canvas_edit_returns_done(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "canvas_edit", "action": "remove_node", "id": "rds"}))
        data = json.loads(ws.receive_text())
        assert data == {"type": "done"}
