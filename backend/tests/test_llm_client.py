import importlib
import pytest


def test_detect_provider_anthropic(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    import llm_client
    importlib.reload(llm_client)
    assert llm_client.ACTIVE_PROVIDER == "anthropic"
    assert llm_client.ACTIVE_KEY == "sk-ant-test"


def test_detect_provider_openai_fallback(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    import llm_client
    importlib.reload(llm_client)
    assert llm_client.ACTIVE_PROVIDER == "openai"


def test_detect_provider_openrouter_fallback(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    import llm_client
    importlib.reload(llm_client)
    assert llm_client.ACTIVE_PROVIDER == "openrouter"


def test_no_key_raises(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    import llm_client
    with pytest.raises(RuntimeError, match="No LLM API key found"):
        importlib.reload(llm_client)


def test_detect_provider_from_dotenv_in_current_working_directory(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=sk-openai-from-dotenv\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    import llm_client

    importlib.reload(llm_client)
    assert llm_client.ACTIVE_PROVIDER == "openai"
    assert llm_client.ACTIVE_KEY == "sk-openai-from-dotenv"
