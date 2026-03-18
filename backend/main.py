import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from admin import is_admin_email
from auth import verify_access_token_user
from generation_service import GenerationStartError, append_chat_history, start_generation_for_user
from project_store import create_project_for_generation, get_project_for_user, reset_stale_generations, update_project_fields
from setup_pdf_service import (
    SetupPdfError,
    create_setup_pdf_download_url_for_user,
    start_setup_pdf_generation_for_user,
)
from supabase_client import supabase
from ws_handler import handle_websocket

logger = logging.getLogger(__name__)


def _assert_single_worker() -> None:
    """Abort startup if the process was launched with multiple workers.

    DrawToCloud uses in-memory state (ProjectBroadcaster, _RUNNING_TASKS,
    _RUNTIMES).  Running more than one worker process silently breaks WebSocket
    delivery: a client subscribed to worker A will never receive events
    broadcast by worker B.

    Two launch vectors are guarded:
    1. ``WEB_CONCURRENCY`` env var  — used by Gunicorn and some PaaS platforms.
    2. ``--workers N`` / ``-w N``   — uvicorn CLI flags, which bypass the env var.
    """
    concurrency = int(os.getenv("WEB_CONCURRENCY", "1"))
    if concurrency != 1:
        raise RuntimeError(
            f"WEB_CONCURRENCY={concurrency} is not supported. "
            "Set WEB_CONCURRENCY=1. Multi-worker support requires Redis pub/sub (planned for V1)."
        )

    argv = sys.argv
    for flag in ("--workers", "-w"):
        if flag in argv:
            idx = argv.index(flag)
            try:
                workers = int(argv[idx + 1])
            except (IndexError, ValueError):
                workers = 0
            if workers != 1:
                raise RuntimeError(
                    f"uvicorn {flag} {workers} is not supported. "
                    "Use a single worker. Multi-worker support requires Redis pub/sub (planned for V1)."
                )


def _warn_if_thumbnails_bucket_missing() -> None:
    """Log a warning if the 'thumbnails' storage bucket is unreachable.

    This is a best-effort check — it does not abort startup. If the bucket
    is missing, thumbnail generation will silently return None at runtime.
    """
    try:
        buckets = supabase.storage.list_buckets()
        names = [b.name for b in buckets] if buckets else []
        if "thumbnails" not in names:
            logger.warning(
                "Supabase Storage bucket 'thumbnails' not found. "
                "OG thumbnail generation will be skipped. "
                "Create the bucket in the Supabase dashboard (public read)."
            )
    except Exception as exc:
        logger.warning("Could not check Supabase Storage buckets: %s", exc)


def _warn_if_setup_pdfs_bucket_missing() -> None:
    """Log a warning if the 'setup-pdfs' storage bucket is unreachable."""
    try:
        buckets = supabase.storage.list_buckets()
        names = [b.name for b in buckets] if buckets else []
        if "setup-pdfs" not in names:
            logger.warning(
                "Supabase Storage bucket 'setup-pdfs' not found. "
                "Setup PDF generation will fail until this bucket exists."
            )
    except Exception as exc:
        logger.warning("Could not check Supabase Storage buckets: %s", exc)


@asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    _assert_single_worker()
    await reset_stale_generations()
    _warn_if_thumbnails_bucket_missing()
    _warn_if_setup_pdfs_bucket_missing()
    yield


app = FastAPI(title="DrawToCloud API", lifespan=_lifespan)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str


class QuestionnaireRequest(BaseModel):
    answers: dict[str, str]


class StartGenerationRequest(BaseModel):
    answers: dict[str, Any]
    project_id: str | None = None
    access_token: str | None = None
    auth_token: str | None = None


class StartGenerationResponse(BaseModel):
    project_id: str
    share_slug: str | None = None
    trace_id: str
    generation_status: str


class StartDiscoveryRequest(BaseModel):
    answers: dict[str, Any]
    project_id: str | None = None
    access_token: str | None = None
    auth_token: str | None = None


class StartDiscoveryResponse(BaseModel):
    project_id: str
    share_slug: str | None = None
    generation_status: str


class EntitlementsResponse(BaseModel):
    is_admin: bool


class SetupPdfGenerateResponse(BaseModel):
    project_id: str
    setup_pdf_status: str
    setup_pdf_progress: int
    setup_pdf_error: str | None = None


class SetupPdfDownloadResponse(BaseModel):
    project_id: str
    setup_pdf_status: str
    download_url: str


class SaveLlmKeyRequest(BaseModel):
    provider: str
    api_key: str
    model: str | None = None


class LlmKeyStatusResponse(BaseModel):
    has_key: bool
    provider: str | None = None
    model: str | None = None


def _normalize_regions(data: dict[str, Any]) -> list[str]:
    regions = data.get("regions")
    if isinstance(regions, list):
        normalized = [entry.strip() for entry in regions if isinstance(entry, str) and entry.strip()]
        if normalized:
            return normalized

    region = data.get("region")
    if isinstance(region, str) and region.strip():
        return [region.strip()]

    return ["us-east-1"]


def _normalize_generation_answers(raw_answers: Any) -> dict[str, Any]:
    if not isinstance(raw_answers, dict):
        answers: dict[str, Any] = {}
    else:
        answers = dict(raw_answers)
    answers["regions"] = _normalize_regions(answers)
    answers.pop("region", None)
    return answers


def _normalize_discovery_answers(raw_answers: Any) -> dict[str, Any]:
    answers = _normalize_generation_answers(raw_answers)
    answers["_mode"] = "chat_first"
    return answers


def _token_from_authorization_header(authorization: str | None) -> str | None:
    if not isinstance(authorization, str) or not authorization.strip():
        return None

    value = authorization.strip()
    if value.lower().startswith("bearer "):
        token = value[7:].strip()
        return token or None
    return None



@app.get(
    "/health",
    summary="Health check",
    description="Returns 200 with `{status: ok}` when the server is running.",
    response_model=HealthResponse,
    responses={200: {"description": "Server is healthy"}},
    tags=["health"],
)
def health():
    return {"status": "ok"}


@app.get(
    "/health/ready",
    summary="Readiness check",
    description="Returns 200 when the server can reach Supabase. Returns 503 if the DB is unreachable. Use this for load balancer health checks.",
    response_model=HealthResponse,
    responses={
        200: {"description": "Server is ready"},
        503: {"description": "DB unreachable"},
    },
    tags=["health"],
)
async def health_ready():
    try:
        await asyncio.to_thread(
            lambda: supabase.table("profiles").select("id").limit(1).execute()
        )
    except Exception as exc:
        logger.warning("Health ready check failed: %s", exc)
        return JSONResponse(status_code=503, content={"status": "db_unreachable"})
    return {"status": "ok"}


@app.post(
    "/api/questionnaire",
    summary="Stream personalized follow-up questions",
    description="Accepts initial questionnaire answers and streams back personalized follow-up questions as SSE events.",
    tags=["questionnaire"],
)
async def questionnaire_endpoint(req: QuestionnaireRequest):
    """
    SSE endpoint for questionnaire follow-up generation.

    Emitted events:
    - data: {"question": {...}} — one per question
    - data: {"done": true} — signals completion
    """
    async def event_stream():
        from agents.questionnaire import generate_followup_questions
        async for question in generate_followup_questions(req.answers):
            yield f"data: {json.dumps({'question': question})}\n\n"
        yield 'data: {"done": true}\n\n'
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post(
    "/api/generations/start",
    summary="Start architecture generation",
    description="Starts a backend-owned generation job. The job keeps running even if websocket disconnects.",
    response_model=StartGenerationResponse,
    tags=["generation"],
)
async def start_generation_endpoint(req: StartGenerationRequest):
    token = req.access_token or req.auth_token
    if not isinstance(token, str) or not token.strip():
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    normalized_answers = _normalize_generation_answers(req.answers)

    try:
        result = await start_generation_for_user(auth_user.user_id, auth_user.email, normalized_answers, req.project_id)
    except GenerationStartError as error:
        raise HTTPException(status_code=400, detail={"error": error.code, "message": error.message}) from error

    return {
        "project_id": str(result["project_id"]),
        "share_slug": result.get("share_slug") if isinstance(result.get("share_slug"), str) else None,
        "trace_id": str(result["trace_id"]),
        "generation_status": str(result["generation_status"]),
    }


@app.post(
    "/api/generations/discovery-start",
    summary="Start or resume discovery mode",
    description="Creates or reuses a project in discovery mode and returns the canonical share slug for /p/{slug}.",
    response_model=StartDiscoveryResponse,
    tags=["generation"],
)
async def start_discovery_endpoint(req: StartDiscoveryRequest):
    token = req.access_token or req.auth_token
    if not isinstance(token, str) or not token.strip():
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    discovery_answers = _normalize_discovery_answers(req.answers)

    try:
        if req.project_id:
            try:
                project_row = await get_project_for_user(req.project_id, auth_user.user_id)
            except Exception:
                project_row = await create_project_for_generation(auth_user.user_id, discovery_answers)
        else:
            project_row = await create_project_for_generation(auth_user.user_id, discovery_answers)

        project_id = str(project_row.get("id", ""))
        if not project_id:
            raise RuntimeError("Project creation returned no ID.")

        await update_project_fields(
            project_id,
            auth_user.user_id,
            {
                "questionnaire_answers": discovery_answers,
                "project_mode": "discovery",
                "generation_status": "idle",
                "generation_stage": "discovery",
                "generation_error": None,
                "generation_trace_id": None,
                "generation_started_at": None,
                "generation_completed_at": None,
                "last_event_at": None,
            },
        )

        opening_question = (
            "Let's design your AWS infrastructure. "
            "First: what does your application do and who are the main users?"
        )
        try:
            await append_chat_history(project_id, auth_user.user_id, "assistant", opening_question)
        except Exception:
            logger.warning("Unable to append discovery opening question project_id=%s", project_id, exc_info=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail={"error": "discovery_start_failed", "message": str(error)}) from error

    return {
        "project_id": project_id,
        "share_slug": project_row.get("share_slug") if isinstance(project_row.get("share_slug"), str) else None,
        "generation_status": "idle",
    }


@app.post(
    "/api/projects/{project_id}/setup-pdf/generate",
    summary="Start setup PDF generation",
    description="Starts project setup PDF generation and streams progress over the project websocket channel.",
    response_model=SetupPdfGenerateResponse,
    tags=["setup-pdf"],
)
async def generate_setup_pdf_endpoint(project_id: str, authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    try:
        result = await start_setup_pdf_generation_for_user(auth_user.user_id, project_id)
    except SetupPdfError as error:
        raise HTTPException(status_code=400, detail={"error": error.code, "message": error.message}) from error

    return {
        "project_id": str(result["project_id"]),
        "setup_pdf_status": str(result["setup_pdf_status"]),
        "setup_pdf_progress": int(result["setup_pdf_progress"]),
        "setup_pdf_error": result.get("setup_pdf_error"),
    }


@app.get(
    "/api/projects/{project_id}/setup-pdf/download",
    summary="Get signed setup PDF download URL",
    description="Returns a short-lived signed URL to download the generated setup PDF for this project.",
    response_model=SetupPdfDownloadResponse,
    tags=["setup-pdf"],
)
async def download_setup_pdf_endpoint(project_id: str, authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    try:
        result = await create_setup_pdf_download_url_for_user(auth_user.user_id, project_id)
    except SetupPdfError as error:
        raise HTTPException(status_code=400, detail={"error": error.code, "message": error.message}) from error

    return {
        "project_id": str(result["project_id"]),
        "setup_pdf_status": str(result["setup_pdf_status"]),
        "download_url": str(result["download_url"]),
    }


@app.get(
    "/api/me/entitlements",
    summary="Fetch user entitlements",
    description="Returns entitlement flags resolved server-side for the authenticated user.",
    response_model=EntitlementsResponse,
    tags=["auth"],
)
async def me_entitlements_endpoint(authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    return {"is_admin": is_admin_email(auth_user.email)}


@app.post(
    "/api/llm-key",
    summary="Save user LLM API key",
    description="Encrypts and stores the user's LLM API key for BYOK usage. One key per user.",
    tags=["byok"],
)
async def save_llm_key_endpoint(
    req: SaveLlmKeyRequest,
    authorization: str | None = Header(default=None),
):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    if req.provider not in ("anthropic", "openrouter", "openai"):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_provider", "message": "Provider must be anthropic, openrouter, or openai."},
        )

    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail={"error": "invalid_key", "message": "API key must not be empty."})

    if req.provider == "openrouter" and not req.model:
        raise HTTPException(status_code=400, detail={"error": "model_required", "message": "Model is required for OpenRouter."})

    from llm_keys import save_user_llm_key

    await save_user_llm_key(auth_user.user_id, req.provider, req.api_key.strip(), req.model)
    return {"status": "saved"}


@app.get(
    "/api/llm-key",
    summary="Check if user has a stored LLM key",
    description="Returns provider and has_key status. Never returns the actual key.",
    response_model=LlmKeyStatusResponse,
    tags=["byok"],
)
async def get_llm_key_endpoint(authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from llm_keys import get_user_llm_key_status

    status = await get_user_llm_key_status(auth_user.user_id)
    if status is None:
        return {"has_key": False, "provider": None, "model": None}
    return status


@app.delete(
    "/api/llm-key",
    summary="Delete user's stored LLM key",
    description="Removes the user's encrypted LLM key from the database.",
    tags=["byok"],
)
async def delete_llm_key_endpoint(authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from llm_keys import delete_user_llm_key

    await delete_user_llm_key(auth_user.user_id)
    return {"status": "deleted"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Main WebSocket endpoint for real-time diagram collaboration.

    Accepted client message types:
    - `chat`        — { type, message, access_token|auth_token, project_id?, selected_node_ids? }
                      Triggers chat analysis or graph mutation planning based on intent.
    - `canvas_edit` — { type, action, id/label/category, access_token|auth_token, project_id? }
                      Triggers full Terraform regeneration (stub in MVP).

    Emitted server message types:
    - `diagram_event` — { type, action, id, label, category } or { type, action, from, to, label }
    - `terraform_file` — { type, filename, content, description }
    - `cost_estimate` — { type, monthly_total, breakdown }
    - `chat_reply`    — { type, message }
    - `chat_reply_done` — { type, project_id, message, mutation? }
                           mutation: { diff, summary, scope } for safe frontend graph updates
    - `setup_pdf_status` — { type, project_id, setup_pdf_status, setup_pdf_progress, setup_pdf_error? }
    - `error`         — { type, error, provider? }
    - `done`          — { type }
    """
    await ws.accept()
    try:
        await handle_websocket(ws)
    except WebSocketDisconnect:
        pass
