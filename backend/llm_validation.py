import asyncio

from llm_client import PROVIDER_MODELS

VALIDATION_TIMEOUT_SECONDS = 10.0
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_REFERER = "https://drawtocloud.app"
VALIDATION_MESSAGE = [{"role": "user", "content": "ping"}]


class LlmKeyValidationError(Exception):
    """Raised when an API key cannot be validated for provider usage."""


def _provider_label(provider: str) -> str:
    if provider == "openai":
        return "OpenAI"
    if provider == "openrouter":
        return "OpenRouter"
    return "Anthropic"


def _error_status_code(error: Exception) -> int | None:
    status = getattr(error, "status_code", None)
    if isinstance(status, int):
        return status

    response = getattr(error, "response", None)
    response_status = getattr(response, "status_code", None)
    if isinstance(response_status, int):
        return response_status
    return None


def _validation_error_message(provider: str, error: Exception) -> str:
    label = _provider_label(provider)
    raw = str(error).strip()
    text = raw.lower()
    status = _error_status_code(error)

    if status in (401, 403) or "invalid api key" in text or "authentication" in text or "incorrect api key" in text:
        return "Invalid API key."

    if "timeout" in text:
        return f"{label} validation timed out. Please try again."

    if "network" in text or "connection" in text or "dns" in text:
        return f"Could not reach {label}. Please try again."

    if "model" in text and ("not found" in text or "does not exist" in text or "invalid" in text):
        if provider == "openrouter":
            return "Model not found on OpenRouter."
        return "Model not found."

    if not raw:
        return f"{label} validation failed."
    return f"{label} validation failed: {raw}"


async def _validate_with_anthropic(api_key: str) -> None:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=VALIDATION_TIMEOUT_SECONDS)
    await client.messages.create(
        model=PROVIDER_MODELS["anthropic"],
        max_tokens=1,
        messages=VALIDATION_MESSAGE,
    )


async def _validate_with_openai(api_key: str) -> None:
    import openai as oai

    client = oai.AsyncOpenAI(api_key=api_key, timeout=VALIDATION_TIMEOUT_SECONDS)
    await client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1,
        messages=VALIDATION_MESSAGE,
    )


async def _validate_with_openrouter(api_key: str, model: str) -> None:
    import openai as oai

    client = oai.AsyncOpenAI(
        api_key=api_key,
        timeout=VALIDATION_TIMEOUT_SECONDS,
        base_url=OPENROUTER_BASE_URL,
        default_headers={"HTTP-Referer": OPENROUTER_REFERER},
    )
    await client.chat.completions.create(
        model=model,
        max_tokens=1,
        messages=VALIDATION_MESSAGE,
    )


async def validate_llm_api_key(provider: str, api_key: str, model: str | None = None) -> None:
    if provider not in PROVIDER_MODELS:
        raise LlmKeyValidationError("Provider must be anthropic, openrouter, or openai.")

    try:
        async with asyncio.timeout(VALIDATION_TIMEOUT_SECONDS):
            if provider == "anthropic":
                await _validate_with_anthropic(api_key)
            elif provider == "openai":
                await _validate_with_openai(api_key)
            else:
                normalized_model = model.strip() if isinstance(model, str) else ""
                if not normalized_model:
                    raise LlmKeyValidationError("Model is required for OpenRouter.")
                await _validate_with_openrouter(api_key, normalized_model)
    except LlmKeyValidationError:
        raise
    except TimeoutError as error:
        raise LlmKeyValidationError(f"{_provider_label(provider)} validation timed out. Please try again.") from error
    except Exception as error:
        raise LlmKeyValidationError(_validation_error_message(provider, error)) from error
