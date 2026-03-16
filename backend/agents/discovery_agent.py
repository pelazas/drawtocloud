"""Discovery interview agent.

Conducts a structured discovery interview to gather application context
before starting the architecture generation pipeline.
"""
from typing import Any, AsyncGenerator

from llm_client import async_stream_text

_PLAN_START = "===ARCHITECTURE_PLAN==="
_PLAN_END = "===END_PLAN==="


def _build_system_prompt(answers: dict[str, Any]) -> str:
    app_name = answers.get("app_name", "your app")
    region = answers.get("region", "us-east-1")
    expected_users = answers.get("expected_users", "1K–100K/mo")
    uptime = answers.get("uptime", "99.9% SLA")
    compliance = answers.get("compliance") or "None"
    environment = answers.get("environment") or "Production"
    compute_preference = answers.get("compute_preference") or "No preference"

    constraints: list[str] = []
    if compliance and compliance != "None":
        constraints.append(f"- Compliance requirement: {compliance}")
    if environment and environment != "Production":
        constraints.append(f"- Environment: {environment}")
    if compute_preference and compute_preference != "No preference":
        constraints.append(f"- Compute preference: {compute_preference}")
    constraints_text = "\n".join(constraints) if constraints else "- None specified"

    return f"""You are DrawToCloud's infrastructure discovery assistant.
Your goal: gather enough context to design a precise AWS architecture for "{app_name}".

Project context already provided:
- Region: {region}
- Expected users: {expected_users}
- Uptime requirement: {uptime}
- Constraints:
{constraints_text}

Rules:
1. Ask EXACTLY ONE question per reply. Never ask multiple questions in one message.
2. Keep questions short and conversational — one sentence each.
3. Suggested discovery sequence (adapt based on prior answers):
   a. What does the app do and who are the main users?
   b. What kind of data does it store and how sensitive is it?
   c. Does it need real-time features, background jobs, or file storage?
   d. What are your peak traffic expectations beyond the expected user count?
   e. Any third-party APIs or integrations?
4. After gathering answers to at least 4 questions AND having sufficient context to design
   the architecture, present a structured plan.

When presenting the plan, respond ONLY with this format (nothing before the start marker):

{_PLAN_START}
Here's the architecture I'd design for {app_name}:

**Core services:** [list key AWS services]
**Network:** [VPC setup, availability zones]
**Storage:** [S3/EFS if needed]
**Estimated cost:** [rough monthly estimate based on scale]

Ready to generate the Terraform? Click "Accept & Generate" to proceed, or tell me what you'd like to change.
{_PLAN_END}

If the user says "generate", "looks good", "accept", "proceed", or anything similar — present the plan immediately even if fewer than 4 questions were asked.
If the user asks to change something in the plan, acknowledge and re-present the full updated plan in the same format.
"""


def _normalize_history(history: Any) -> list[dict[str, str]]:
    if not isinstance(history, list):
        return []
    messages: list[dict[str, str]] = []
    for entry in history:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    return messages


def detect_plan_ready(response_text: str) -> tuple[str, bool]:
    """Return (cleaned_message, plan_ready).

    Strips the plan markers and returns plan_ready=True when the response
    contains a structured architecture plan.
    """
    if _PLAN_START not in response_text:
        return response_text.strip(), False

    start = response_text.find(_PLAN_START)
    end = response_text.find(_PLAN_END)
    if end != -1:
        plan_content = response_text[start + len(_PLAN_START):end].strip()
    else:
        plan_content = response_text[start + len(_PLAN_START):].strip()

    return plan_content, True


async def stream_discovery_reply(
    user_message: str,
    history: list[dict[str, Any]],
    answers: dict[str, Any],
    llm_creds: dict[str, Any] | None = None,
) -> AsyncGenerator[tuple[str, bool], None]:
    """Stream a discovery reply chunk by chunk.

    Yields (chunk, is_plan_sentinel) tuples.
    The final chunk yields ("", True) when the full response contains a plan.
    """
    normalized = _normalize_history(history)
    messages = [*normalized, {"role": "user", "content": user_message}]
    system_prompt = _build_system_prompt(answers)

    chunks: list[str] = []
    async for chunk in async_stream_text(messages=messages, system=system_prompt, llm_creds=llm_creds):
        if isinstance(chunk, str) and chunk:
            chunks.append(chunk)
            yield chunk, False

    full_response = "".join(chunks)
    _, plan_ready = detect_plan_ready(full_response)
    if plan_ready:
        yield "", True
