from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from setup_pdf_service import SetupPdfError


def test_generate_setup_pdf_requires_token(client):
    response = client.post("/api/projects/project-123/setup-pdf/generate")

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_generate_setup_pdf_rejects_invalid_token(client):
    with patch("main.verify_access_token_user", return_value=None):
        response = client.post(
            "/api/projects/project-123/setup-pdf/generate",
            headers={"Authorization": "Bearer bad-token"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "invalid_token"


def test_generate_setup_pdf_starts_generation(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    result = {
        "project_id": "project-123",
        "setup_pdf_status": "generating",
        "setup_pdf_progress": 10,
        "setup_pdf_error": None,
    }

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.start_setup_pdf_generation_for_user", new=AsyncMock(return_value=result)) as mock_start:
            response = client.post(
                "/api/projects/project-123/setup-pdf/generate",
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    assert response.json() == result
    mock_start.assert_awaited_once_with("user-123", "project-123")


def test_generate_setup_pdf_surfaces_domain_errors(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch(
            "main.start_setup_pdf_generation_for_user",
            new=AsyncMock(side_effect=SetupPdfError("pipeline_not_completed", "Architecture is still running.")),
        ):
            response = client.post(
                "/api/projects/project-123/setup-pdf/generate",
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "pipeline_not_completed",
        "message": "Architecture is still running.",
    }


def test_download_setup_pdf_requires_token(client):
    response = client.get("/api/projects/project-123/setup-pdf/download")

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_download_setup_pdf_returns_signed_url(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    result = {
        "project_id": "project-123",
        "setup_pdf_status": "ready",
        "download_url": "https://example.supabase.co/storage/v1/object/sign/setup-pdfs/project-123/setup-guide.pdf?token=abc",
    }

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.create_setup_pdf_download_url_for_user", new=AsyncMock(return_value=result)) as mock_download:
            response = client.get(
                "/api/projects/project-123/setup-pdf/download",
                headers={"Authorization": "Bearer good-token"},
            )

    assert response.status_code == 200
    assert response.json() == result
    mock_download.assert_awaited_once_with("user-123", "project-123")
