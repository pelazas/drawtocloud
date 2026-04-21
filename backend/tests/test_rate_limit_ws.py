import importlib
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

import main as main_module
import ws_handler


def _make_ws_client(monkeypatch, ws_per_ip: str = "2", ws_per_user: str = "2"):
    monkeypatch.setenv("RATE_LIMIT_WS_PER_IP", ws_per_ip)
    monkeypatch.setenv("RATE_LIMIT_WS_PER_USER", ws_per_user)
    importlib.reload(main_module)
    importlib.reload(ws_handler)
    return TestClient(main_module.app)


class TestWsRateLimitByIp:
    def test_allows_connections_under_ip_limit(self, monkeypatch):
        client = _make_ws_client(monkeypatch)
        with client.websocket_connect("/ws") as ws1:
            with client.websocket_connect("/ws") as ws2:
                pass

    def test_rejects_connections_over_ip_limit(self, monkeypatch):
        client = _make_ws_client(monkeypatch)
        with client.websocket_connect("/ws") as ws1:
            with client.websocket_connect("/ws") as ws2:
                with pytest.raises(Exception):
                    with client.websocket_connect("/ws") as ws3:
                        pass


class TestWsRateLimitByUser:
    def test_rejects_connections_over_user_limit(self, monkeypatch):
        client = _make_ws_client(monkeypatch, ws_per_ip="10", ws_per_user="2")
        auth_user = SimpleNamespace(user_id="user-123", email="a@example.com")
        with patch.object(ws_handler, "verify_access_token_user", return_value=auth_user):
            with client.websocket_connect("/ws") as ws1:
                ws1.send_text(json.dumps({"type": "chat", "message": "hi", "access_token": "tok"}))
                _ = json.loads(ws1.receive_text())  # consume error from missing project
                with client.websocket_connect("/ws") as ws2:
                    ws2.send_text(json.dumps({"type": "chat", "message": "hi", "access_token": "tok"}))
                    _ = json.loads(ws2.receive_text())  # consume error from missing project
                    with client.websocket_connect("/ws") as ws3:
                        ws3.send_text(json.dumps({"type": "chat", "message": "hi", "access_token": "tok"}))
                        data = json.loads(ws3.receive_text())
                        assert data["type"] == "error"
                        assert "rate_limit" in data["error"]
