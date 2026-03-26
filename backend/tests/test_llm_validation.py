import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llm_validation import LlmKeyValidationError, validate_llm_api_key


def test_validate_openrouter_requires_model():
    with pytest.raises(LlmKeyValidationError, match="Model is required for OpenRouter."):
        asyncio.run(validate_llm_api_key(provider="openrouter", api_key="sk-test", model=None))


def test_validate_openai_uses_tiny_completion():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=object())

    with patch("openai.AsyncOpenAI", return_value=mock_client) as mock_ctor:
        asyncio.run(validate_llm_api_key(provider="openai", api_key="sk-test"))

    mock_ctor.assert_called_once_with(api_key="sk-test", timeout=10.0)
    mock_client.chat.completions.create.assert_awaited_once_with(
        model="gpt-4o",
        max_tokens=1,
        messages=[{"role": "user", "content": "ping"}],
    )


def test_validate_anthropic_uses_provider_default_model():
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=object())

    with patch("anthropic.AsyncAnthropic", return_value=mock_client) as mock_ctor:
        asyncio.run(validate_llm_api_key(provider="anthropic", api_key="sk-test"))

    mock_ctor.assert_called_once_with(api_key="sk-test", timeout=10.0)
    mock_client.messages.create.assert_awaited_once_with(
        model="claude-sonnet-4-20250514",
        max_tokens=1,
        messages=[{"role": "user", "content": "ping"}],
    )


def test_validate_openrouter_invalid_model_returns_clear_message():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=Exception("Model not found"))

    with patch("openai.AsyncOpenAI", return_value=mock_client):
        with pytest.raises(LlmKeyValidationError, match="Model not found on OpenRouter."):
            asyncio.run(
                validate_llm_api_key(
                    provider="openrouter",
                    api_key="sk-test",
                    model="fake/model",
                )
            )
