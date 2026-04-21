import importlib
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

import main as main_module


def _make_client(monkeypatch, ip_rpm: str = "2", user_rpm: str = "2"):
    monkeypatch.setenv("RATE_LIMIT_IP_RPM", ip_rpm)
    monkeypatch.setenv("RATE_LIMIT_USER_RPM", user_rpm)
    importlib.reload(main_module)
    return TestClient(main_module.app)


class TestHttpRateLimitByIp:
    def test_allows_requests_under_limit(self, monkeypatch):
        client = _make_client(monkeypatch)
        resp = client.get("/health")
        assert resp.status_code == 200
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_blocks_requests_over_limit(self, monkeypatch):
        client = _make_client(monkeypatch)
        for _ in range(2):
            client.get("/health")
        resp = client.get("/health")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers
        assert int(resp.headers["Retry-After"]) > 0
        assert resp.json()["error"] == "rate_limit_exceeded"

    def test_separate_ips_have_independent_limits(self, monkeypatch):
        client = _make_client(monkeypatch)
        for _ in range(2):
            client.get("/health")
        resp = client.get("/health", headers={"X-Forwarded-For": "9.9.9.9"})
        assert resp.status_code == 200


class TestHttpRateLimitByUser:
    def test_expensive_endpoint_uses_user_limit(self, monkeypatch):
        client = _make_client(monkeypatch)
        auth_user = SimpleNamespace(user_id="user-123", email="a@example.com")
        with patch.object(main_module, "verify_access_token_user", return_value=auth_user):
            for _ in range(2):
                resp = client.post("/api/generations/start", json={"answers": {}, "access_token": "tok"})
                assert resp.status_code in (200, 400)
            resp = client.post("/api/generations/start", json={"answers": {}, "access_token": "tok"})
            assert resp.status_code == 429
            assert resp.json()["error"] == "rate_limit_exceeded"

    def test_different_users_have_independent_limits(self, monkeypatch):
        client = _make_client(monkeypatch, ip_rpm="10", user_rpm="2")
        auth_user_a = SimpleNamespace(user_id="user-a", email="a@example.com")
        auth_user_b = SimpleNamespace(user_id="user-b", email="b@example.com")
        with patch.object(main_module, "verify_access_token_user", return_value=auth_user_a):
            for _ in range(2):
                client.post("/api/generations/start", json={"answers": {}, "access_token": "tok-a"})
        with patch.object(main_module, "verify_access_token_user", return_value=auth_user_b):
            resp = client.post("/api/generations/start", json={"answers": {}, "access_token": "tok-b"})
            assert resp.status_code in (200, 400)
