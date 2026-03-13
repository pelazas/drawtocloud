from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from generation_service import GenerationStartError


def test_start_generation_requires_token(client):
    response = client.post("/api/generations/start", json={"answers": {"app_name": "Demo"}})

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_start_generation_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.post(
            "/api/generations/start",
            json={"answers": {"app_name": "Demo"}, "access_token": "bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "invalid_token"


def test_start_generation_returns_project_and_trace(client):
    result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
        "created_project": True,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="admin@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.start_generation_for_user", new=AsyncMock(return_value=result)) as mock_start:
            response = client.post(
                "/api/generations/start",
                json={"answers": {"app_name": "Demo"}, "access_token": "good-token"},
            )

    assert response.status_code == 200
    assert response.json() == {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
    }
    mock_start.assert_awaited_once_with("user-123", "admin@example.com", {"app_name": "Demo"}, None)


def test_start_generation_surfaces_domain_errors(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch(
            "main.start_generation_for_user",
            new=AsyncMock(side_effect=GenerationStartError("quota_exhausted", "No quota left")),
        ):
            response = client.post(
                "/api/generations/start",
                json={"answers": {"app_name": "Demo"}, "access_token": "good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {"error": "quota_exhausted", "message": "No quota left"}


def test_entitlements_requires_authorization_header(client):
    response = client.get("/api/me/entitlements")

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_entitlements_returns_is_admin_true(client):
    auth_user = SimpleNamespace(user_id="user-123", email="admin@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.is_admin_email", return_value=True):
            response = client.get("/api/me/entitlements", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"is_admin": True}


def test_entitlements_returns_is_admin_false(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.is_admin_email", return_value=False):
            response = client.get("/api/me/entitlements", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"is_admin": False}
