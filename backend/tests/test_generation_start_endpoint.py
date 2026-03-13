from unittest.mock import AsyncMock, patch

from generation_service import GenerationStartError


def test_start_generation_requires_token(client):
    response = client.post("/api/generations/start", json={"answers": {"app_name": "Demo"}})

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_start_generation_rejects_invalid_token(client):
    with patch("main.verify_access_token", return_value=None):
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

    with patch("main.verify_access_token", return_value="user-123"):
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
    mock_start.assert_awaited_once_with("user-123", {"app_name": "Demo"}, None)


def test_start_generation_surfaces_domain_errors(client):
    with patch("main.verify_access_token", return_value="user-123"):
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
