import importlib
import os
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient


def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_response_body(client):
    response = client.get("/health")
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# CORS tests — each needs a fresh app instance so env changes take effect
# ---------------------------------------------------------------------------

def _make_client(monkeypatch, allowed_origins: str | None = None):
    """
    Reload the main module after optionally setting ALLOWED_ORIGINS so that
    the CORSMiddleware is built with the new value.
    """
    if allowed_origins is None:
        monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("ALLOWED_ORIGINS", allowed_origins)

    import main as main_module
    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_cors_default_origin_allowed(monkeypatch):
    """With no ALLOWED_ORIGINS set, localhost:3000 must be reflected back."""
    test_client = _make_client(monkeypatch)
    response = test_client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_cors_custom_origin_allowed(monkeypatch):
    """When ALLOWED_ORIGINS lists example.com, that origin must be reflected."""
    test_client = _make_client(
        monkeypatch,
        allowed_origins="http://example.com,http://app.example.com",
    )
    response = test_client.get("/health", headers={"Origin": "http://example.com"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://example.com"


def test_cors_unlisted_origin_not_reflected(monkeypatch):
    """When ALLOWED_ORIGINS is custom, an unlisted origin must NOT be reflected."""
    test_client = _make_client(
        monkeypatch,
        allowed_origins="http://example.com,http://app.example.com",
    )
    response = test_client.get("/health", headers={"Origin": "http://evil.com"})
    assert response.status_code == 200
    # The origin should not be echoed back
    assert response.headers.get("access-control-allow-origin") != "http://evil.com"


# ---------------------------------------------------------------------------
# CORS method/header restriction tests — issue #229
# ---------------------------------------------------------------------------

_ALLOWED_METHODS = {"GET", "POST", "PATCH", "DELETE"}
_ALLOWED_HEADERS = {"authorization", "content-type", "x-requested-with"}


def test_cors_preflight_allowed_methods(monkeypatch):
    """Preflight response must list only the explicitly allowed HTTP methods."""
    test_client = _make_client(monkeypatch)
    response = test_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    allow_methods = {
        m.strip()
        for m in response.headers.get("access-control-allow-methods", "").split(",")
        if m.strip()
    }
    assert allow_methods == _ALLOWED_METHODS


def test_cors_preflight_disallowed_method_blocked(monkeypatch):
    """Preflight for PUT must be rejected (400) since PUT is not in the allow list."""
    test_client = _make_client(monkeypatch)
    response = test_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
        },
    )
    assert response.status_code == 400


def test_cors_preflight_allowed_headers(monkeypatch):
    """Preflight response must include the explicitly allowed headers (plus simple headers)."""
    test_client = _make_client(monkeypatch)
    response = test_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, content-type, x-requested-with",
        },
    )
    assert response.status_code == 200
    allow_headers = {
        h.strip().lower()
        for h in response.headers.get("access-control-allow-headers", "").split(",")
        if h.strip()
    }
    assert _ALLOWED_HEADERS.issubset(allow_headers)


def test_cors_preflight_disallowed_header_blocked(monkeypatch):
    """Preflight for a non-allowed header must be rejected (400)."""
    test_client = _make_client(monkeypatch)
    response = test_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-custom-header",
        },
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# /health/ready tests
# ---------------------------------------------------------------------------

def test_health_ready_returns_200_when_db_ok(client):
    """Returns 200 with {"status": "ok"} when Supabase is reachable."""
    with patch("main.supabase") as mock_supabase:
        # Simulate a successful DB query chain: .table().select().limit().execute()
        execute_chain = mock_supabase.table.return_value.select.return_value.limit.return_value
        execute_chain.execute.return_value = None  # success, no exception

        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_returns_503_when_db_unavailable(client):
    """Returns 503 with {"status": "db_unreachable"} when Supabase throws."""
    with patch("main.supabase") as mock_supabase:
        execute_chain = mock_supabase.table.return_value.select.return_value.limit.return_value
        execute_chain.execute.side_effect = Exception("connection refused")

        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "db_unreachable"}
