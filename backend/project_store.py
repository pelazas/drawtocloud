import asyncio
import json
import logging
import string
import secrets
from datetime import datetime, timezone
from typing import Any

from supabase_client import supabase

logger = logging.getLogger(__name__)

ALPHABET = string.ascii_lowercase + string.digits
SLUG_LENGTH = 8
MAX_SLUG_ATTEMPTS = 15


class TemplateNotFoundError(RuntimeError):
    """Raised when the requested template slug does not exist."""


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
            "id, user_id, title, project_mode, questionnaire_answers, nodes, edges, terraform_files, "
            "cost_estimate, chat_history, description, share_slug, generation_status, "
            "generation_stage, generation_error, generation_trace_id, generation_started_at, "
            "generation_completed_at, last_event_at, thumbnail_url, setup_pdf_status, "
            "setup_pdf_url, setup_pdf_storage_path, setup_pdf_generated_at, "
            "setup_pdf_source_revision, setup_pdf_error, setup_pdf_progress"
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
        "project_mode": "default",
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
        "setup_pdf_status": "none",
        "setup_pdf_url": None,
        "setup_pdf_storage_path": None,
        "setup_pdf_generated_at": None,
        "setup_pdf_source_revision": None,
        "setup_pdf_error": None,
        "setup_pdf_progress": 0,
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
                "id, share_slug, title, project_mode, questionnaire_answers, nodes, edges, terraform_files, "
                "cost_estimate, chat_history, description, generation_status, generation_stage, "
                "generation_error, generation_trace_id, generation_started_at, generation_completed_at, "
                "last_event_at, thumbnail_url, setup_pdf_status, setup_pdf_url, "
                "setup_pdf_storage_path, setup_pdf_generated_at, setup_pdf_source_revision, "
                "setup_pdf_error, setup_pdf_progress"
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


def _create_named_project_sync(user_id: str, name: str) -> dict[str, Any]:
    title = name.strip()[:120] if name.strip() else "Untitled Project"

    payload = {
        "user_id": user_id,
        "title": title,
        "project_mode": "default",
        "questionnaire_answers": {},
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
        "setup_pdf_status": "none",
        "setup_pdf_url": None,
        "setup_pdf_storage_path": None,
        "setup_pdf_generated_at": None,
        "setup_pdf_source_revision": None,
        "setup_pdf_error": None,
        "setup_pdf_progress": 0,
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
            if (
                isinstance(row, dict)
                and isinstance(row.get("id"), str)
                and isinstance(row.get("share_slug"), str)
                and isinstance(row.get("title"), str)
            ):
                return row

        fetched = (
            supabase.table("projects")
            .select("id, share_slug, title")
            .eq("user_id", user_id)
            .eq("share_slug", slug)
            .single()
            .execute()
        )
        fetched_data = getattr(fetched, "data", None)
        if (
            isinstance(fetched_data, dict)
            and isinstance(fetched_data.get("id"), str)
            and isinstance(fetched_data.get("share_slug"), str)
            and isinstance(fetched_data.get("title"), str)
        ):
            return fetched_data

    if last_error is not None:
        raise last_error
    raise RuntimeError("Unable to create project with a unique slug.")


async def create_named_project(user_id: str, name: str) -> dict[str, Any]:
    return await asyncio.to_thread(_create_named_project_sync, user_id, name)


def _update_project_fields_sync(project_id: str, user_id: str, fields: dict[str, Any]) -> None:
    payload = {**fields, "updated_at": _utc_now()}
    response = (
        supabase.table("projects")
        .update(payload)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    data = getattr(response, "data", None)
    if isinstance(data, list) and len(data) == 0:
        logger.warning(
            "update_project_fields matched 0 rows project_id=%s user_id=%s fields=%s",
            project_id, user_id, list(fields.keys()),
        )


def _reset_stale_generations_sync() -> int:
    """Reset projects stuck in running/queued state after a server restart. Returns count reset."""
    response = (
        supabase.table("projects")
        .update({
            "generation_status": "failed",
            "generation_error": "Server restarted mid-generation.",
            "generation_completed_at": _utc_now(),
        })
        .in_("generation_status", ["running", "queued"])
        .execute()
    )
    data = getattr(response, "data", None)
    return len(data) if isinstance(data, list) else 0


async def reset_stale_generations() -> None:
    """Called at startup to clean up projects left in running/queued state by a previous crash."""
    try:
        count = await asyncio.to_thread(_reset_stale_generations_sync)
        if count > 0:
            logger.info("Startup cleanup: reset %d stale generation(s) to 'failed'.", count)
    except Exception:
        logger.warning("Startup cleanup failed — stale generations may remain.", exc_info=True)


async def update_project_fields(project_id: str, user_id: str, fields: dict[str, Any]) -> None:
    await asyncio.to_thread(_update_project_fields_sync, project_id, user_id, fields)


def _save_canvas_snapshot_sync(
    project_id: str,
    user_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    payload = {"nodes": nodes, "edges": edges, "updated_at": _utc_now()}
    response = (
        supabase.table("projects")
        .update(payload)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    data = getattr(response, "data", None)
    if isinstance(data, list):
        if len(data) == 0:
            raise RuntimeError("Project not found or not owned by user.")
        return

    ownership_response = (
        supabase.table("projects")
        .select("id")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    ownership_data = getattr(ownership_response, "data", None)
    if not (isinstance(ownership_data, dict) and isinstance(ownership_data.get("id"), str)):
        raise RuntimeError("Project not found or not owned by user.")


async def save_canvas_snapshot(
    project_id: str,
    user_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    await asyncio.to_thread(_save_canvas_snapshot_sync, project_id, user_id, nodes, edges)


def _append_chat_message_sync(project_id: str, user_id: str, message: dict[str, Any]) -> None:
    """Atomic JSONB append via the append_chat_message Supabase RPC.

    The RPC does:
        UPDATE projects
        SET chat_history = coalesce(chat_history, '[]') || jsonb_build_array(p_message)
        WHERE id = p_project_id AND user_id = p_user_id

    This replaces the read-modify-write pattern and is safe under concurrent calls.
    Requires migration 006_append_chat_message_rpc.sql to be applied.
    """
    supabase.rpc(
        "append_chat_message",
        {"p_project_id": project_id, "p_user_id": user_id, "p_message": message},
    ).execute()


async def append_chat_message(project_id: str, user_id: str, message: dict[str, Any]) -> None:
    """Atomically append a single chat message to a project's chat_history column."""
    await asyncio.to_thread(_append_chat_message_sync, project_id, user_id, message)


def _list_template_projects_sync() -> list[dict[str, Any]]:
    response = (
        supabase.table("projects")
        .select("title, share_slug, thumbnail_url, description")
        .eq("is_template", True)
        .order("updated_at", desc=True)
        .execute()
    )
    data = getattr(response, "data", None)
    if not isinstance(data, list):
        return []

    templates: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue

        slug = row.get("share_slug")
        title = row.get("title")
        if not isinstance(slug, str) or not slug.strip() or not isinstance(title, str) or not title.strip():
            continue

        thumbnail_url = row.get("thumbnail_url") if isinstance(row.get("thumbnail_url"), str) else None
        raw_description = row.get("description")
        description: str | None = None
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
        elif isinstance(raw_description, dict):
            overview = raw_description.get("overview")
            if isinstance(overview, str) and overview.strip():
                description = overview.strip()
        templates.append(
            {
                "title": title.strip(),
                "share_slug": slug.strip(),
                "thumbnail_url": thumbnail_url,
                "description": description,
            }
        )

    return templates


async def list_template_projects() -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_template_projects_sync)


def _get_template_project_detail_sync(template_slug: str) -> dict[str, Any]:
    response = (
        supabase.table("projects")
        .select(
            "title, share_slug, thumbnail_url, nodes, edges, terraform_files, "
            "cost_estimate, description"
        )
        .eq("is_template", True)
        .eq("share_slug", template_slug)
        .single()
        .execute()
    )
    data = getattr(response, "data", None)
    if not isinstance(data, dict):
        raise TemplateNotFoundError("Template not found.")

    title = data.get("title") if isinstance(data.get("title"), str) else "Untitled Template"
    share_slug = data.get("share_slug") if isinstance(data.get("share_slug"), str) else template_slug
    raw_description = data.get("description")
    if isinstance(raw_description, dict):
        arch_description = raw_description
    elif isinstance(raw_description, str):
        try:
            parsed_description = json.loads(raw_description)
            arch_description = parsed_description if isinstance(parsed_description, dict) else None
        except json.JSONDecodeError:
            arch_description = None
    else:
        arch_description = None

    return {
        "title": title,
        "share_slug": share_slug,
        "thumbnail_url": data.get("thumbnail_url") if isinstance(data.get("thumbnail_url"), str) else None,
        "nodes": data.get("nodes") if isinstance(data.get("nodes"), list) else [],
        "edges": data.get("edges") if isinstance(data.get("edges"), list) else [],
        "terraform_files": data.get("terraform_files") if isinstance(data.get("terraform_files"), list) else [],
        "cost_estimate": data.get("cost_estimate"),
        "arch_description": arch_description,
    }


async def get_template_project_detail(template_slug: str) -> dict[str, Any]:
    return await asyncio.to_thread(_get_template_project_detail_sync, template_slug)


def _clone_template_project_for_user_sync(template_slug: str, user_id: str) -> dict[str, Any]:
    template = (
        supabase.table("projects")
        .select(
            "title, questionnaire_answers, nodes, edges, terraform_files, "
            "cost_estimate, description, thumbnail_url"
        )
        .eq("is_template", True)
        .eq("share_slug", template_slug)
        .single()
        .execute()
    )
    template_data = getattr(template, "data", None)
    if not isinstance(template_data, dict):
        raise TemplateNotFoundError("Template not found.")

    payload = {
        "user_id": user_id,
        "title": template_data.get("title") if isinstance(template_data.get("title"), str) else "Untitled Project",
        "project_mode": "default",
        "questionnaire_answers": template_data.get("questionnaire_answers")
        if isinstance(template_data.get("questionnaire_answers"), dict)
        else {},
        "nodes": template_data.get("nodes") if isinstance(template_data.get("nodes"), list) else [],
        "edges": template_data.get("edges") if isinstance(template_data.get("edges"), list) else [],
        "terraform_files": template_data.get("terraform_files") if isinstance(template_data.get("terraform_files"), list) else [],
        "cost_estimate": template_data.get("cost_estimate"),
        "description": template_data.get("description"),
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
        "generation_error": None,
        "generation_trace_id": None,
        "generation_started_at": None,
        "generation_completed_at": _utc_now(),
        "last_event_at": _utc_now(),
        "thumbnail_url": template_data.get("thumbnail_url") if isinstance(template_data.get("thumbnail_url"), str) else None,
        "is_template": False,
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

        fetched = (
            supabase.table("projects")
            .select("id, share_slug")
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
    raise RuntimeError("Unable to clone template with a unique slug.")


async def clone_template_project_for_user(template_slug: str, user_id: str) -> dict[str, Any]:
    return await asyncio.to_thread(_clone_template_project_for_user_sync, template_slug, user_id)
