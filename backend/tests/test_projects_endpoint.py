from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def test_create_project_requires_authorization_header(client):
    response = client.post("/api/projects", json={"name": "My Project"})

    assert response.status_code == 401
    assert response.json()["detail"] == {"error": "unauthenticated", "message": "Missing access token."}


def test_create_project_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.post(
            "/api/projects",
            json={"name": "My Project"},
            headers={"Authorization": "Bearer bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == {"error": "invalid_token", "message": "Invalid access token."}


def test_create_project_returns_project_id_and_slug(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    created = {"id": "project-123", "share_slug": "abcd1234", "title": "My Project"}

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.create_named_project", new=AsyncMock(return_value=created)) as mock_create:
            response = client.post(
                "/api/projects",
                json={"name": "My Project"},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    assert response.json() == {"project_id": "project-123", "share_slug": "abcd1234"}
    mock_create.assert_awaited_once_with("user-123", "My Project")


def test_create_project_returns_error_when_creation_fails(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.create_named_project", new=AsyncMock(side_effect=RuntimeError("boom"))):
            response = client.post(
                "/api/projects",
                json={"name": "My Project"},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {"error": "project_create_failed", "message": "boom"}


def test_create_project_returns_error_when_created_payload_is_incomplete(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.create_named_project", new=AsyncMock(return_value={"title": "Missing IDs"})):
            response = client.post(
                "/api/projects",
                json={"name": "My Project"},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "project_create_failed",
        "message": "Project creation returned incomplete data.",
    }


def test_save_snapshot_requires_authorization_header(client):
    response = client.patch(
        "/api/projects/project-123/snapshot",
        json={"nodes": [], "edges": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_save_snapshot_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.patch(
            "/api/projects/project-123/snapshot",
            json={"nodes": [], "edges": []},
            headers={"Authorization": "Bearer bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "invalid_token"


def test_save_snapshot_returns_ok(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.save_canvas_snapshot", new=AsyncMock(), create=True) as mock_save:
            response = client.patch(
                "/api/projects/project-123/snapshot",
                json={"nodes": [{"id": "n1"}], "edges": [{"id": "e1"}]},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    mock_save.assert_awaited_once_with(
        "project-123", "user-123", [{"id": "n1"}], [{"id": "e1"}], structure_changed=True
    )


def test_save_snapshot_returns_error_when_save_fails(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.save_canvas_snapshot", new=AsyncMock(side_effect=RuntimeError("boom")), create=True):
            response = client.patch(
                "/api/projects/project-123/snapshot",
                json={"nodes": [{"id": "n1"}], "edges": [{"id": "e1"}]},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {"error": "snapshot_save_failed", "message": "boom"}


def test_save_snapshot_forwards_structure_changed_false(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.save_canvas_snapshot", new=AsyncMock(), create=True) as mock_save:
            response = client.patch(
                "/api/projects/project-123/snapshot",
                json={"nodes": [{"id": "n1"}], "edges": [{"id": "e1"}], "structure_changed": False},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    mock_save.assert_awaited_once_with(
        "project-123", "user-123", [{"id": "n1"}], [{"id": "e1"}], structure_changed=False
    )


def test_update_project_requires_authorization_header(client):
    response = client.patch("/api/projects/project-123", json={"title": "Renamed"})

    assert response.status_code == 401
    assert response.json()["detail"] == {"error": "unauthenticated", "message": "Missing access token."}


def test_update_project_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.patch(
            "/api/projects/project-123",
            json={"title": "Renamed"},
            headers={"Authorization": "Bearer bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == {"error": "invalid_token", "message": "Invalid access token."}


def test_update_project_rejects_empty_payload(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        response = client.patch(
            "/api/projects/project-123",
            json={},
            headers={"Authorization": "Bearer good-token"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "project_update_failed",
        "message": "At least one mutable field is required.",
    }


def test_update_project_normalizes_title_and_returns_ok(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.update_project_fields", new=AsyncMock(), create=True) as mock_update:
            response = client.patch(
                "/api/projects/project-123",
                json={"title": "  Renamed Project  "},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    mock_update.assert_awaited_once_with("project-123", "user-123", {"title": "Renamed Project"})


def test_update_project_returns_error_when_store_fails(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.update_project_fields", new=AsyncMock(side_effect=RuntimeError("boom")), create=True):
            response = client.patch(
                "/api/projects/project-123",
                json={"title": "Renamed"},
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {"error": "project_update_failed", "message": "boom"}
