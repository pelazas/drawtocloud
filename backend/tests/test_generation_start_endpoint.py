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
    mock_start.assert_awaited_once_with(
        "user-123",
        "admin@example.com",
        {"app_name": "Demo", "regions": ["us-east-1"]},
        None,
    )


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


def test_start_discovery_requires_token(client):
    response = client.post("/api/generations/discovery-start", json={"answers": {"app_name": "Demo"}})

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_start_discovery_returns_project_and_slug(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    row = {"id": "project-123", "share_slug": "slug-123"}

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.create_project_for_generation", new=AsyncMock(return_value=row)) as mock_create:
            with patch("main.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("main.append_chat_history", new=AsyncMock()) as mock_append:
                    response = client.post(
                        "/api/generations/discovery-start",
                        json={"answers": {"app_name": "Demo", "regions": ["us-east-1"]}, "access_token": "good-token"},
                    )

    assert response.status_code == 200
    assert response.json() == {
        "project_id": "project-123",
        "share_slug": "slug-123",
        "generation_status": "idle",
    }
    mock_create.assert_awaited_once()
    update_payload = mock_update.await_args.args[2]
    assert update_payload["project_mode"] == "discovery"
    assert update_payload["generation_stage"] == "discovery"
    assert update_payload["questionnaire_answers"]["_mode"] == "chat_first"
    mock_append.assert_awaited_once()


def test_start_discovery_reuses_project_when_owned(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    existing_row = {"id": "project-existing", "share_slug": "slug-existing"}

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.get_project_for_user", new=AsyncMock(return_value=existing_row)) as mock_get:
            with patch("main.create_project_for_generation", new=AsyncMock()) as mock_create:
                with patch("main.update_project_fields", new=AsyncMock()):
                    with patch("main.append_chat_history", new=AsyncMock()):
                        response = client.post(
                            "/api/generations/discovery-start",
                            json={
                                "answers": {"app_name": "Demo", "regions": ["us-east-1"]},
                                "project_id": "project-existing",
                                "access_token": "good-token",
                            },
                        )

    assert response.status_code == 200
    assert response.json()["project_id"] == "project-existing"
    mock_get.assert_awaited_once_with("project-existing", "user-123")
    mock_create.assert_not_awaited()


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
