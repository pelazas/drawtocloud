import importlib


def _reload_llm_client(monkeypatch, anthropic=None, openai=None, openrouter=None):
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")

    if anthropic is None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    else:
        monkeypatch.setenv("ANTHROPIC_API_KEY", anthropic)

    if openai is None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENAI_API_KEY", openai)

    if openrouter is None:
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENROUTER_API_KEY", openrouter)

    import llm_client

    return importlib.reload(llm_client)


def test_detect_provider_anthropic(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch, anthropic="sk-ant-test")

    assert llm_client._ENV_CREDS == ("anthropic", "claude-sonnet-4-20250514", "sk-ant-test")


def test_detect_provider_openai_fallback(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch, openai="sk-openai-test")

    assert llm_client._ENV_CREDS == ("openai", "gpt-4o", "sk-openai-test")


def test_detect_provider_openrouter_fallback(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch, openrouter="sk-or-test")

    assert llm_client._ENV_CREDS == ("openrouter", "qwen/qwen3-235b-a22b-2507", "sk-or-test")


def test_no_key_sets_env_creds_none(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch)

    assert llm_client._ENV_CREDS is None


def test_resolve_creds_prefers_explicit_llm_creds(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch, anthropic="env-key")

    provider, model, api_key = llm_client._resolve_creds(
        {"provider": "openrouter", "api_key": "byok", "model": "deepseek/deepseek-chat"}
    )

    assert (provider, model, api_key) == ("openrouter", "deepseek/deepseek-chat", "byok")


def test_resolve_creds_raises_without_env_or_explicit(monkeypatch):
    llm_client = _reload_llm_client(monkeypatch)

    try:
        llm_client._resolve_creds(None)
    except RuntimeError as error:
        assert "No LLM API key found" in str(error)
    else:
        raise AssertionError("Expected RuntimeError when no env creds are configured")


def test_detect_provider_from_dotenv_in_current_working_directory(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)

    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=sk-openai-from-dotenv\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    import llm_client

    llm_client = importlib.reload(llm_client)
    assert llm_client._ENV_CREDS == ("openai", "gpt-4o", "sk-openai-from-dotenv")
    assert llm_client.ACTIVE_PROVIDER == "openai"
    assert llm_client.ACTIVE_KEY == "sk-openai-from-dotenv"


def test_async_stream_text_passes_max_tokens_to_anthropic():
    """async_stream_text forwards max_tokens to Anthropic streaming client."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch

    class EmptyAsyncIterator:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    mock_stream_ctx = AsyncMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_stream_ctx.text_stream = EmptyAsyncIterator()

    mock_messages = MagicMock()
    mock_messages.stream = MagicMock(return_value=mock_stream_ctx)

    mock_client = MagicMock()
    mock_client.messages = mock_messages

    async def run():
        with patch("llm_client._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("anthropic.AsyncAnthropic", return_value=mock_client) as mock_anthropic_client:
                from llm_client import async_stream_text

                async for _ in async_stream_text(
                    messages=[{"role": "user", "content": "hi"}],
                    system="test",
                    max_tokens=16384,
                ):
                    pass

        mock_anthropic_client.assert_called_once()
        _, client_kwargs = mock_anthropic_client.call_args
        assert "timeout" in client_kwargs
        mock_messages.stream.assert_called_once()
        _, call_kwargs = mock_messages.stream.call_args
        assert call_kwargs["max_tokens"] == 16384

    asyncio.run(run())


def test_async_stream_text_sets_timeout_for_openai_client():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock, patch

    class EmptyChunkIterator:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=EmptyChunkIterator())

    async def run():
        with patch("llm_client._resolve_creds", return_value=("openai", "gpt-4o", "sk-test")):
            with patch("openai.AsyncOpenAI", return_value=mock_client) as mock_openai_client:
                from llm_client import async_stream_text

                async for _ in async_stream_text(
                    messages=[{"role": "user", "content": "hi"}],
                    system="test",
                ):
                    pass

        mock_openai_client.assert_called_once()
        _, client_kwargs = mock_openai_client.call_args
        assert "timeout" in client_kwargs

    asyncio.run(run())


def test_async_complete_times_out_when_keepalive_stream_has_no_content():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock, patch

    import pytest

    class KeepAliveOnlyIterator:
        def __init__(self):
            self._chunks = iter(
                [
                    SimpleNamespace(choices=[]),
                    SimpleNamespace(choices=[]),
                ]
            )

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as stop:
                raise StopAsyncIteration from stop

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=KeepAliveOnlyIterator())

    async def run():
        with patch("llm_client._resolve_creds", return_value=("openrouter", "model-x", "sk-test")):
            with patch("openai.AsyncOpenAI", return_value=mock_client):
                with patch("time.monotonic", side_effect=[0.0, 61.0]):
                    from llm_client import async_complete

                    with pytest.raises(TimeoutError, match="No content"):
                        await async_complete(
                            messages=[{"role": "user", "content": "hello"}],
                            system="test",
                        )

    asyncio.run(run())
