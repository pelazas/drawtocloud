import os
from typing import Any, AsyncGenerator


def _detect_provider() -> tuple[str, str, str] | None:
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", "claude-sonnet-4-20250514", key
    if key := os.environ.get("OPENAI_API_KEY"):
        return "openai", "gpt-4o", key
    if key := os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter", "qwen/qwen3-235b-a22b-2507", key
    return None


_ENV_CREDS = _detect_provider()

PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
    "openai": "gpt-4o",
}


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
) -> AsyncGenerator[str, None]:
    provider, model, api_key = _resolve_creds(llm_creds)

    if provider == "anthropic":
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=api_key)
        async with client.messages.stream(
            model=model,
            max_tokens=2048,
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
        )
        if provider == "openrouter":
            client = oai.AsyncOpenAI(
                api_key=api_key,
                base_url="https://openrouter.ai/api/v1",
                default_headers={"HTTP-Referer": "https://drawtocloud.app"},
            )
        else:
            client = oai.AsyncOpenAI(api_key=api_key)

        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            yield chunk.choices[0].delta.content or ""


async def async_complete(
    messages: list[dict],
    system: str,
    llm_creds: dict[str, Any] | None = None,
) -> str:
    buffer = ""
    async for chunk in async_stream_text(messages, system, llm_creds):
        buffer += chunk
    return buffer
