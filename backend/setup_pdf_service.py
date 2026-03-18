import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from generation_service import broadcast_project_event
from project_store import get_project_for_user, update_project_fields
from setup_pdf_generator import build_setup_pdf
from supabase_client import supabase

logger = logging.getLogger(__name__)

SETUP_PDF_BUCKET = "setup-pdfs"
SIGNED_URL_TTL_SECONDS = 3600

_SETUP_PDF_TASKS: dict[str, asyncio.Task[None]] = {}
_SETUP_PDF_TASKS_LOCK = asyncio.Lock()


class SetupPdfError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_payload(project_row: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": project_row.get("title"),
        "questionnaire_answers": project_row.get("questionnaire_answers") if isinstance(project_row.get("questionnaire_answers"), dict) else {},
        "nodes": project_row.get("nodes") if isinstance(project_row.get("nodes"), list) else [],
        "edges": project_row.get("edges") if isinstance(project_row.get("edges"), list) else [],
        "terraform_files": project_row.get("terraform_files") if isinstance(project_row.get("terraform_files"), list) else [],
        "cost_estimate": project_row.get("cost_estimate"),
        "description": project_row.get("description"),
    }


def compute_setup_pdf_source_revision(project_row: dict[str, Any]) -> str:
    canonical = json.dumps(_canonical_payload(project_row), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _effective_setup_pdf_status(project_row: dict[str, Any]) -> str:
    status_raw = project_row.get("setup_pdf_status")
    status = status_raw if isinstance(status_raw, str) else "none"

    if status == "ready":
        stored_revision = project_row.get("setup_pdf_source_revision")
        if isinstance(stored_revision, str) and stored_revision:
            current_revision = compute_setup_pdf_source_revision(project_row)
            if current_revision != stored_revision:
                return "outdated"

    return status


async def _emit_status_event(
    project_id: str,
    *,
    status: str,
    progress: int,
    message: str | None = None,
    error: str | None = None,
    generated_at: str | None = None,
    source_revision: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "setup_pdf_status",
        "setup_pdf_status": status,
        "setup_pdf_progress": int(max(0, min(100, progress))),
        "setup_pdf_error": error,
    }
    if message:
        payload["message"] = message
    if generated_at:
        payload["setup_pdf_generated_at"] = generated_at
    if source_revision:
        payload["setup_pdf_source_revision"] = source_revision
    await broadcast_project_event(project_id, payload)


async def _update_status(
    project_id: str,
    user_id: str,
    *,
    status: str,
    progress: int,
    error: str | None = None,
    generated_at: str | None = None,
    source_revision: str | None = None,
    storage_path: str | None = None,
    signed_url: str | None = None,
) -> None:
    fields: dict[str, Any] = {
        "setup_pdf_status": status,
        "setup_pdf_progress": int(max(0, min(100, progress))),
        "setup_pdf_error": error,
    }
    if generated_at is not None:
        fields["setup_pdf_generated_at"] = generated_at
    if source_revision is not None:
        fields["setup_pdf_source_revision"] = source_revision
    if storage_path is not None:
        fields["setup_pdf_storage_path"] = storage_path
    if signed_url is not None:
        fields["setup_pdf_url"] = signed_url
    await update_project_fields(project_id, user_id, fields)


def _upload_pdf_and_sign(storage_path: str, pdf_bytes: bytes) -> str:
    bucket = supabase.storage.from_(SETUP_PDF_BUCKET)
    bucket.upload(
        storage_path,
        pdf_bytes,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    signed = bucket.create_signed_url(storage_path, SIGNED_URL_TTL_SECONDS)
    signed_url = signed.get("signedURL") or signed.get("signedUrl")
    if not isinstance(signed_url, str) or not signed_url.strip():
        raise RuntimeError("Unable to create signed setup PDF URL.")
    return signed_url


def _create_signed_url(storage_path: str) -> str:
    signed = supabase.storage.from_(SETUP_PDF_BUCKET).create_signed_url(storage_path, SIGNED_URL_TTL_SECONDS)
    signed_url = signed.get("signedURL") or signed.get("signedUrl")
    if not isinstance(signed_url, str) or not signed_url.strip():
        raise RuntimeError("Unable to create signed setup PDF URL.")
    return signed_url


async def _run_setup_pdf_generation(user_id: str, project_id: str) -> None:
    try:
        await _update_status(project_id, user_id, status="generating", progress=10, error=None)
        await _emit_status_event(
            project_id,
            status="generating",
            progress=10,
            message="Gathering project artifacts...",
        )

        project_row = await get_project_for_user(project_id, user_id)
        source_revision = compute_setup_pdf_source_revision(project_row)

        await _update_status(project_id, user_id, status="generating", progress=25)
        await _emit_status_event(
            project_id,
            status="generating",
            progress=25,
            message="Writing generic setup sections...",
        )

        await _update_status(project_id, user_id, status="generating", progress=55)
        await _emit_status_event(
            project_id,
            status="generating",
            progress=55,
            message="Writing project-specific sections...",
        )

        generated_at = _now_utc_iso()
        render_payload = {
            "id": project_row.get("id"),
            "title": project_row.get("title"),
            "questionnaire_answers": project_row.get("questionnaire_answers"),
            "nodes": project_row.get("nodes"),
            "edges": project_row.get("edges"),
            "terraform_files": project_row.get("terraform_files"),
            "thumbnail_url": project_row.get("thumbnail_url"),
        }

        await _update_status(project_id, user_id, status="generating", progress=85)
        await _emit_status_event(
            project_id,
            status="generating",
            progress=85,
            message="Rendering setup PDF...",
        )

        loop = asyncio.get_running_loop()
        pdf_bytes = await loop.run_in_executor(None, build_setup_pdf, render_payload, generated_at)

        storage_path = f"{project_id}/setup-guide.pdf"
        signed_url = await loop.run_in_executor(None, _upload_pdf_and_sign, storage_path, pdf_bytes)

        await _update_status(
            project_id,
            user_id,
            status="ready",
            progress=100,
            error=None,
            generated_at=generated_at,
            source_revision=source_revision,
            storage_path=storage_path,
            signed_url=signed_url,
        )
        await _emit_status_event(
            project_id,
            status="ready",
            progress=100,
            message="Setup PDF ready.",
            generated_at=generated_at,
            source_revision=source_revision,
        )
    except Exception as error:
        logger.error("Setup PDF generation failed project_id=%s error=%s", project_id, error, exc_info=True)
        await _update_status(
            project_id,
            user_id,
            status="failed",
            progress=0,
            error=str(error),
        )
        await _emit_status_event(
            project_id,
            status="failed",
            progress=0,
            message="Setup PDF generation failed.",
            error=str(error),
        )
    finally:
        async with _SETUP_PDF_TASKS_LOCK:
            _SETUP_PDF_TASKS.pop(project_id, None)


async def start_setup_pdf_generation_for_user(user_id: str, project_id: str) -> dict[str, Any]:
    project_row = await get_project_for_user(project_id, user_id)
    generation_status = project_row.get("generation_status")
    generation_stage = project_row.get("generation_stage")
    if generation_status != "completed" and generation_stage != "completed":
        raise SetupPdfError(
            "pipeline_not_completed",
            "Setup PDF generation is available only after architecture generation is completed.",
        )

    existing_status = _effective_setup_pdf_status(project_row)
    existing_progress = project_row.get("setup_pdf_progress")
    progress = int(existing_progress) if isinstance(existing_progress, (int, float)) else 0

    async with _SETUP_PDF_TASKS_LOCK:
        current = _SETUP_PDF_TASKS.get(project_id)
        if current and not current.done():
            return {
                "project_id": project_id,
                "setup_pdf_status": "generating",
                "setup_pdf_progress": max(progress, 1),
                "setup_pdf_error": None,
            }

        await _update_status(project_id, user_id, status="generating", progress=0, error=None)
        await _emit_status_event(
            project_id,
            status="generating",
            progress=0,
            message="Queued setup PDF generation...",
        )
        task = asyncio.create_task(_run_setup_pdf_generation(user_id, project_id))
        _SETUP_PDF_TASKS[project_id] = task

    if existing_status == "outdated":
        progress = 0

    return {
        "project_id": project_id,
        "setup_pdf_status": "generating",
        "setup_pdf_progress": max(progress, 0),
        "setup_pdf_error": None,
    }


async def create_setup_pdf_download_url_for_user(user_id: str, project_id: str) -> dict[str, Any]:
    project_row = await get_project_for_user(project_id, user_id)
    status = _effective_setup_pdf_status(project_row)

    if status == "generating":
        raise SetupPdfError("setup_pdf_generating", "Setup PDF is still generating. Please wait.")

    storage_path = project_row.get("setup_pdf_storage_path")
    if not isinstance(storage_path, str) or not storage_path.strip():
        raise SetupPdfError("setup_pdf_not_ready", "Setup PDF is not ready yet. Generate it first.")

    if status not in {"ready", "outdated"}:
        raise SetupPdfError("setup_pdf_not_ready", "Setup PDF is not ready yet. Generate it first.")

    loop = asyncio.get_running_loop()
    signed_url = await loop.run_in_executor(None, _create_signed_url, storage_path)
    await update_project_fields(project_id, user_id, {"setup_pdf_url": signed_url})

    if status == "outdated" and project_row.get("setup_pdf_status") == "ready":
        await update_project_fields(project_id, user_id, {"setup_pdf_status": "outdated"})

    return {
        "project_id": project_id,
        "setup_pdf_status": status,
        "download_url": signed_url,
    }
