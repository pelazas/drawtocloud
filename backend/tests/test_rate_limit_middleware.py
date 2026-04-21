import importlib
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient


def _make_client(monkeypatch, ip_rpm: str = "2", user_rpm: str = "2"):
    monkeypatch.setenv("RATE_LIMIT_IP_RPM", ip_rpm)
    monkeypatch.setenv("RATE_LIMIT_USER_RPM", user_rpm)
    import main as main_module
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
