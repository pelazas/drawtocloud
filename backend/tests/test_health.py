import importlib
import os

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
