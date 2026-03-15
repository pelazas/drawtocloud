import asyncio
import string
import secrets
from datetime import datetime, timezone
from typing import Any

from supabase_client import supabase

ALPHABET = string.ascii_lowercase + string.digits
SLUG_LENGTH = 8
MAX_SLUG_ATTEMPTS = 15


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _generate_slug() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(SLUG_LENGTH))


def _is_duplicate_slug_error(error: Exception) -> bool:
    message = str(error).lower()
    return "duplicate key" in message and "share_slug" in message


def _normalize_answers(answers: Any) -> dict[str, str | list[str]]:
    if not isinstance(answers, dict):
        return {}

    normalized: dict[str, str | list[str]] = {}
    for key, value in answers.items():
        if isinstance(value, str) and value.strip():
            normalized[key] = value.strip()
        elif isinstance(value, list):
            items = [item for item in value if isinstance(item, str) and item.strip()]
            if items:
                normalized[key] = items

    return normalized


def _summarize_answers(answers: dict[str, str | list[str]]) -> str | None:
    preferred_keys = ("app_name", "project_name", "name", "app_type", "description")
    for key in preferred_keys:
        value = answers.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    for value in answers.values():
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value:
            candidate = value[0]
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

    return None


def derive_project_title(answers: Any) -> str:
    normalized = _normalize_answers(answers)
    summary = _summarize_answers(normalized)
    if not summary:
        return "Untitled Project"

    compact = " ".join(summary.split())
    return compact[:120]


def _get_project_for_user_sync(project_id: str, user_id: str) -> dict[str, Any]:
    response = (
        supabase.table("projects")
        .select(
            "id, user_id, title, questionnaire_answers, nodes, edges, terraform_files, "
            "cost_estimate, chat_history, description, share_slug, generation_status, "
            "generation_stage, generation_error, generation_trace_id, generation_started_at, "
            "generation_completed_at, last_event_at"
        )
        .eq("id", project_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    data = getattr(response, "data", None)
    if not isinstance(data, dict):
        raise RuntimeError("Project not found.")

    return data


async def get_project_for_user(project_id: str, user_id: str) -> dict[str, Any]:
    return await asyncio.to_thread(_get_project_for_user_sync, project_id, user_id)


def _create_project_for_generation_sync(user_id: str, questionnaire_answers: Any) -> dict[str, Any]:
    answers = _normalize_answers(questionnaire_answers)
    title = derive_project_title(answers)

    payload = {
        "user_id": user_id,
        "title": title,
        "questionnaire_answers": answers,
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "idle",
        "generation_stage": None,
        "generation_error": None,
        "generation_trace_id": None,
        "generation_started_at": None,
        "generation_completed_at": None,
        "last_event_at": None,
        "updated_at": _utc_now(),
    }

    last_error: Exception | None = None
    for _ in range(MAX_SLUG_ATTEMPTS):
        slug = _generate_slug()
        try:
            result = (
                supabase.table("projects")
                .insert({**payload, "share_slug": slug})
                .execute()
            )
        except Exception as error:
            if _is_duplicate_slug_error(error):
                last_error = error
                continue
            raise

        data = getattr(result, "data", None)
        if isinstance(data, list) and data:
            row = data[0]
            if isinstance(row, dict):
                return row

        # If no row payload was returned, fetch by slug.
        fetched = (
            supabase.table("projects")
            .select(
                "id, share_slug, title, questionnaire_answers, nodes, edges, terraform_files, "
                "cost_estimate, chat_history, description, generation_status, generation_stage, "
                "generation_error, generation_trace_id, generation_started_at, generation_completed_at, "
                "last_event_at"
            )
            .eq("user_id", user_id)
            .eq("share_slug", slug)
            .single()
            .execute()
        )
        fetched_data = getattr(fetched, "data", None)
        if isinstance(fetched_data, dict):
            return fetched_data

    if last_error is not None:
        raise last_error
    raise RuntimeError("Unable to create project with a unique slug.")


async def create_project_for_generation(user_id: str, questionnaire_answers: Any) -> dict[str, Any]:
    return await asyncio.to_thread(_create_project_for_generation_sync, user_id, questionnaire_answers)


def _update_project_fields_sync(project_id: str, user_id: str, fields: dict[str, Any]) -> None:
    payload = {**fields, "updated_at": _utc_now()}
    (
        supabase.table("projects")
        .update(payload)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )


async def update_project_fields(project_id: str, user_id: str, fields: dict[str, Any]) -> None:
    await asyncio.to_thread(_update_project_fields_sync, project_id, user_id, fields)
