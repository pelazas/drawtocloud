import importlib


def _reload_llm_client(monkeypatch, anthropic=None, openai=None, openrouter=None):
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
