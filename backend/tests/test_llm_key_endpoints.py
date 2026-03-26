from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from llm_validation import LlmKeyValidationError


def test_get_llm_key_requires_authorization_header(client):
    response = client.get("/api/llm-key")

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "unauthenticated"


def test_save_llm_key_validates_provider(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        response = client.post(
            "/api/llm-key",
            headers={"Authorization": "Bearer token"},
            json={"provider": "invalid", "api_key": "sk-test"},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "invalid_provider"


def test_save_llm_key_requires_model_for_openrouter(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("main.verify_access_token_user", return_value=auth_user):
        response = client.post(
            "/api/llm-key",
            headers={"Authorization": "Bearer token"},
            json={"provider": "openrouter", "api_key": "sk-test"},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "model_required"


def test_get_llm_key_returns_status_payload(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("llm_keys.get_user_llm_key_status", new=AsyncMock(return_value=None)):
            response = client.get(
                "/api/llm-key",
                headers={"Authorization": "Bearer token"},
            )

    assert response.status_code == 200
    assert response.json() == {"has_key": False, "provider": None, "model": None}


def test_save_and_delete_llm_key_success(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.validate_llm_api_key", new=AsyncMock(return_value=None)):
            with patch("llm_keys.save_user_llm_key", new=AsyncMock(return_value={})) as mock_save:
                save_response = client.post(
                    "/api/llm-key",
                    headers={"Authorization": "Bearer token"},
                    json={"provider": "anthropic", "api_key": " sk-test "},
                )

        with patch("llm_keys.delete_user_llm_key", new=AsyncMock(return_value=None)) as mock_delete:
            delete_response = client.delete(
                "/api/llm-key",
                headers={"Authorization": "Bearer token"},
            )

    assert save_response.status_code == 200
    assert save_response.json() == {"status": "saved"}
    mock_save.assert_awaited_once_with("user-123", "anthropic", "sk-test", None)

    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "deleted"}
    mock_delete.assert_awaited_once_with("user-123")


def test_save_llm_key_validates_before_persisting(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.validate_llm_api_key", new=AsyncMock(return_value=None)) as mock_validate:
            with patch("llm_keys.save_user_llm_key", new=AsyncMock(return_value={})) as mock_save:
                response = client.post(
                    "/api/llm-key",
                    headers={"Authorization": "Bearer token"},
                    json={"provider": "openrouter", "api_key": " sk-test ", "model": "qwen/qwen3.5-9b"},
                )

    assert response.status_code == 200
    assert response.json() == {"status": "saved"}
    mock_validate.assert_awaited_once_with(
        provider="openrouter",
        api_key="sk-test",
        model="qwen/qwen3.5-9b",
    )
    mock_save.assert_awaited_once_with("user-123", "openrouter", "sk-test", "qwen/qwen3.5-9b")


def test_save_llm_key_returns_422_when_validation_fails(client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")

    with patch("main.verify_access_token_user", return_value=auth_user):
        with patch("main.validate_llm_api_key", new=AsyncMock(side_effect=LlmKeyValidationError("Invalid API key"))):
            with patch("llm_keys.save_user_llm_key", new=AsyncMock(return_value={})) as mock_save:
                response = client.post(
                    "/api/llm-key",
                    headers={"Authorization": "Bearer token"},
                    json={"provider": "openai", "api_key": "sk-invalid"},
                )

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "llm_key_validation_failed"
    assert response.json()["detail"]["message"] == "Invalid API key"
    mock_save.assert_not_called()
