import os
from pathlib import Path
from typing import AsyncGenerator

from dotenv import load_dotenv


def _load_local_env_files() -> None:
    """Load .env from common backend launch locations."""
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


def _detect_provider() -> tuple[str, str, str]:
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", "claude-sonnet-4-20250514", key
    if key := os.environ.get("OPENAI_API_KEY"):
        return "openai", "gpt-4o", key
    if key := os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter", "qwen/qwen3-235b-a22b-2507", key
    raise RuntimeError(
        "No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY."
    )


_load_local_env_files()
ACTIVE_PROVIDER, ACTIVE_MODEL, ACTIVE_KEY = _detect_provider()


async def async_stream_text(messages: list[dict], system: str) -> AsyncGenerator[str, None]:
    if ACTIVE_PROVIDER == "anthropic":
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=ACTIVE_KEY)
        async with client.messages.stream(
            model=ACTIVE_MODEL,
            max_tokens=2048,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
    else:
        import openai as oai

        kwargs = dict(
            model=ACTIVE_MODEL,
            messages=[{"role": "system", "content": system}] + messages,
            stream=True,
        )
        if ACTIVE_PROVIDER == "openrouter":
            client = oai.AsyncOpenAI(
                api_key=ACTIVE_KEY,
                base_url="https://openrouter.ai/api/v1",
                default_headers={"HTTP-Referer": "https://drawtocloud.app"},
            )
        else:
            client = oai.AsyncOpenAI(api_key=ACTIVE_KEY)
        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            yield chunk.choices[0].delta.content or ""


async def async_complete(messages: list[dict], system: str) -> str:
    buffer = ""
    async for chunk in async_stream_text(messages, system):
        buffer += chunk
    return buffer
