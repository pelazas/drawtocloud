from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def test_get_templates_returns_public_template_metadata(client):
    templates = [
        {"title": "ECS + RDS", "share_slug": "tmpl0001", "thumbnail_url": "https://cdn.example/t1.png"},
        {"title": "Lambda + API Gateway", "share_slug": "tmpl0002", "thumbnail_url": None},
    ]

    with patch("main.list_template_projects", new=AsyncMock(return_value=templates), create=True):
        response = client.get("/api/templates")

    assert response.status_code == 200
    assert response.json() == templates


def test_clone_template_requires_token(client):
    response = client.post("/api/templates/tmpl0001/clone", json={})

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_clone_template_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.post(
            "/api/templates/tmpl0001/clone",
            json={"access_token": "bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "invalid_token"


def test_clone_template_reserves_quota_when_no_admin_and_no_byok(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.is_admin_email", return_value=False, create=True):
            with patch("main.get_user_llm_key_status", new=AsyncMock(return_value=None), create=True):
                with patch(
                    "main.check_and_reserve_quota",
                    new=AsyncMock(return_value={"ok": True, "error": None, "generations_used": 1, "generations_limit": 5}),
                    create=True,
                ) as mock_quota:
                    with patch(
                        "main.clone_template_project_for_user",
                        new=AsyncMock(return_value={"id": "project-1", "share_slug": "clone1234"}),
                        create=True,
                    ) as mock_clone:
                        response = client.post(
                            "/api/templates/tmpl0001/clone",
                            json={"access_token": "good-token"},
                        )

    assert response.status_code == 200
    assert response.json() == {"share_slug": "clone1234"}
    mock_quota.assert_awaited_once_with("user-123")
    mock_clone.assert_awaited_once_with("tmpl0001", "user-123")


def test_clone_template_bypasses_quota_for_byok_user(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.is_admin_email", return_value=False, create=True):
            with patch("main.get_user_llm_key_status", new=AsyncMock(return_value={"has_key": True}), create=True):
                with patch("main.check_and_reserve_quota", new=AsyncMock(), create=True) as mock_quota:
                    with patch(
                        "main.clone_template_project_for_user",
                        new=AsyncMock(return_value={"id": "project-1", "share_slug": "clone1234"}),
                        create=True,
                    ):
                        response = client.post(
                            "/api/templates/tmpl0001/clone",
                            json={"access_token": "good-token"},
                        )

    assert response.status_code == 200
    assert response.json() == {"share_slug": "clone1234"}
    mock_quota.assert_not_awaited()


def test_clone_template_returns_quota_exhausted_error(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.is_admin_email", return_value=False, create=True):
            with patch("main.get_user_llm_key_status", new=AsyncMock(return_value=None), create=True):
                with patch(
                    "main.check_and_reserve_quota",
                    new=AsyncMock(return_value={"ok": False, "error": "quota_exhausted", "generations_used": 5, "generations_limit": 5}),
                    create=True,
                ):
                    response = client.post(
                        "/api/templates/tmpl0001/clone",
                        json={"access_token": "good-token"},
                    )

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "quota_exhausted"
