import os
import time
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from dotenv import load_dotenv


def _load_local_env_files() -> None:
    """Load .env from common backend launch locations."""
    if os.environ.get("PYTHON_DOTENV_DISABLED"):
        return

    module_dir = Path(__file__).resolve().parent
    candidates = [
        Path.cwd() / ".env",
        module_dir / ".env",
        module_dir.parent / ".env",
    ]

    loaded: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in loaded or not resolved.is_file():
            continue
        load_dotenv(dotenv_path=resolved, override=False)
        loaded.add(resolved)


def _detect_provider() -> tuple[str, str, str] | None:
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", "claude-sonnet-4-20250514", key
    if key := os.environ.get("OPENAI_API_KEY"):
        return "openai", "gpt-4o", key
    if key := os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter", "qwen/qwen3-235b-a22b-2507", key
    return None


_load_local_env_files()
_ENV_CREDS = _detect_provider()

if _ENV_CREDS is None:
    ACTIVE_PROVIDER = None
    ACTIVE_MODEL = None
    ACTIVE_KEY = None
else:
    ACTIVE_PROVIDER, ACTIVE_MODEL, ACTIVE_KEY = _ENV_CREDS

PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
    "openai": "gpt-4o",
}

HTTP_CLIENT_TIMEOUT = httpx.Timeout(connect=30.0, read=90.0, write=60.0, pool=60.0)
CONTENT_STALL_TIMEOUT_SECONDS = 60.0


def _resolve_creds(llm_creds: dict[str, Any] | None = None) -> tuple[str, str, str]:
    """Return (provider, model, api_key) from explicit creds or env fallback."""
    if llm_creds:
        provider = llm_creds["provider"]
        api_key = llm_creds["api_key"]
        model = llm_creds.get("model") or PROVIDER_MODELS.get(provider, "")
        return provider, model, api_key

    if _ENV_CREDS is None:
        raise RuntimeError(
            "No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY, "
            "or configure a BYOK key."
        )
    return _ENV_CREDS


async def async_stream_text(
    messages: list[dict],
    system: str,
    llm_creds: dict[str, Any] | None = None,
    max_tokens: int = 2048,
) -> AsyncGenerator[str, None]:
    provider, model, api_key = _resolve_creds(llm_creds)

    if provider == "anthropic":
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=api_key, timeout=HTTP_CLIENT_TIMEOUT)
        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
    else:
        import openai as oai

        kwargs = dict(
            model=model,
            messages=[{"role": "system", "content": system}] + messages,
            stream=True,
            max_tokens=max_tokens,
        )
        if provider == "openrouter":
            client = oai.AsyncOpenAI(
                api_key=api_key,
                timeout=HTTP_CLIENT_TIMEOUT,
                base_url="https://openrouter.ai/api/v1",
                default_headers={"HTTP-Referer": "https://drawtocloud.app"},
            )
        else:
            client = oai.AsyncOpenAI(api_key=api_key, timeout=HTTP_CLIENT_TIMEOUT)

        stream = await client.chat.completions.create(**kwargs)
        last_content_at = time.monotonic()
        async for chunk in stream:
            if not chunk.choices:
                if time.monotonic() - last_content_at > CONTENT_STALL_TIMEOUT_SECONDS:
                    raise TimeoutError(
                        f"No content received from {provider} stream for {CONTENT_STALL_TIMEOUT_SECONDS:.0f}s"
                    )
                continue
            content = chunk.choices[0].delta.content or ""
            if content:
                last_content_at = time.monotonic()
            yield content


async def async_complete(
    messages: list[dict],
    system: str,
    llm_creds: dict[str, Any] | None = None,
    max_tokens: int = 2048,
) -> str:
    buffer = ""
    async for chunk in async_stream_text(messages, system, llm_creds, max_tokens=max_tokens):
        buffer += chunk
    return buffer
