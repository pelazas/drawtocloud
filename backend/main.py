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
from generation_service import GenerationStartError, start_generation_for_user
from llm_keys import get_user_llm_key_status
from llm_validation import LlmKeyValidationError, validate_llm_api_key
from project_store import (
    TemplateNotFoundError,
    clone_template_project_for_user,
    create_named_project,
    get_project_for_user,
    get_template_project_detail,
    list_template_projects,
    reset_stale_generations,
    save_canvas_snapshot,
    update_project_fields,
)
from quota import check_and_reserve_quota
from setup_pdf_service import (
    SetupPdfError,
    create_setup_pdf_download_url_for_user,
    start_setup_pdf_generation_for_user,
)
from supabase_client import supabase
from ws_handler import handle_websocket

logger = logging.getLogger(__name__)


def _configure_application_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    uvicorn_error_logger = logging.getLogger("uvicorn.error")
    uvicorn_handlers = list(uvicorn_error_logger.handlers)
    root_logger = logging.getLogger()

    if not uvicorn_handlers and not root_logger.handlers:
        fallback_handler = logging.StreamHandler()
        fallback_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        root_logger.addHandler(fallback_handler)
        logger.info("Configured fallback root logging handler")

    for logger_name in ("agents", "agents.coder", "generation_service", "llm_client", "ws_handler", "project_store"):
        app_logger = logging.getLogger(logger_name)
        app_logger.setLevel(level)
        if uvicorn_handlers:
            app_logger.handlers = uvicorn_handlers
            app_logger.propagate = False
        else:
            app_logger.propagate = True

    if root_logger.level == logging.NOTSET or root_logger.level > level:
        root_logger.setLevel(level)


_configure_application_logging()


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
    _configure_application_logging()
    _assert_single_worker()
    await reset_stale_generations()
    _warn_if_thumbnails_bucket_missing()
    _warn_if_setup_pdfs_bucket_missing()
    yield


app = FastAPI(title="DrawToCloud API", lifespan=_lifespan)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3100")
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


class TemplateSummaryResponse(BaseModel):
    title: str
    share_slug: str
    thumbnail_url: str | None = None
    description: str | None = None


class TemplateDetailResponse(BaseModel):
    title: str
    share_slug: str
    thumbnail_url: str | None = None
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    terraform_files: list[dict[str, Any]]
    cost_estimate: dict[str, Any] | None = None
    arch_description: dict[str, Any] | None = None


class CloneTemplateRequest(BaseModel):
    access_token: str | None = None
    auth_token: str | None = None


class CloneTemplateResponse(BaseModel):
    share_slug: str


class CreateProjectRequest(BaseModel):
    name: str


class CreateProjectResponse(BaseModel):
    project_id: str
    share_slug: str


class SaveSnapshotRequest(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class UpdateProjectRequest(BaseModel):
    title: str | None = None


class UpdateProjectResponse(BaseModel):
    ok: bool


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
    "/api/projects",
    summary="Create a named project",
    description="Creates an empty project initialized in idle generation state.",
    response_model=CreateProjectResponse,
    tags=["projects"],
)
async def create_project_endpoint(req: CreateProjectRequest, authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    try:
        project_row = await create_named_project(auth_user.user_id, req.name)
    except Exception as error:
        raise HTTPException(status_code=400, detail={"error": "project_create_failed", "message": str(error)}) from error

    project_id = project_row.get("id") if isinstance(project_row, dict) else None
    share_slug = project_row.get("share_slug") if isinstance(project_row, dict) else None
    if not isinstance(project_id, str) or not project_id.strip() or not isinstance(share_slug, str) or not share_slug.strip():
        raise HTTPException(
            status_code=400,
            detail={"error": "project_create_failed", "message": "Project creation returned incomplete data."},
        )

    return {"project_id": project_id, "share_slug": share_slug}


@app.patch(
    "/api/projects/{project_id}",
    summary="Update project fields",
    description="Updates mutable project metadata for an owned project. Currently supports title rename.",
    response_model=UpdateProjectResponse,
    tags=["projects"],
)
async def update_project_endpoint(
    project_id: str,
    req: UpdateProjectRequest,
    authorization: str | None = Header(default=None),
):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    fields: dict[str, Any] = {}
    if req.title is not None:
        normalized_title = req.title.strip()
        fields["title"] = normalized_title[:120] if normalized_title else "Untitled Project"

    if not fields:
        raise HTTPException(
            status_code=400,
            detail={"error": "project_update_failed", "message": "At least one mutable field is required."},
        )

    try:
        await update_project_fields(project_id, auth_user.user_id, fields)
    except Exception as error:
        raise HTTPException(status_code=400, detail={"error": "project_update_failed", "message": str(error)}) from error

    return {"ok": True}


@app.patch(
    "/api/projects/{project_id}/snapshot",
    summary="Save project canvas snapshot",
    description="Stores full canvas nodes and edges for an owned project.",
    tags=["projects"],
)
async def save_snapshot_endpoint(
    project_id: str,
    req: SaveSnapshotRequest,
    authorization: str | None = Header(default=None),
):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    try:
        await save_canvas_snapshot(project_id, auth_user.user_id, req.nodes, req.edges)
    except Exception as error:
        raise HTTPException(status_code=400, detail={"error": "snapshot_save_failed", "message": str(error)}) from error

    return {"ok": True}


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


@app.get(
    "/api/templates",
    summary="List architecture templates",
    description="Returns all template project metadata for dashboard template selection.",
    response_model=list[TemplateSummaryResponse],
    tags=["templates"],
)
async def list_templates_endpoint():
    try:
        return await list_template_projects()
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={"error": "templates_fetch_failed", "message": "Unable to load templates right now."},
        ) from error


@app.get(
    "/api/templates/{slug}",
    summary="Get template detail",
    description="Returns full template snapshot data for in-place canvas loading.",
    response_model=TemplateDetailResponse,
    tags=["templates"],
)
async def template_detail_endpoint(slug: str):
    try:
        return await get_template_project_detail(slug)
    except TemplateNotFoundError as error:
        raise HTTPException(status_code=404, detail={"error": "template_not_found", "message": str(error)}) from error
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={"error": "template_fetch_failed", "message": "Unable to load template right now."},
        ) from error


@app.post(
    "/api/templates/{slug}/clone",
    summary="Clone a template project",
    description="Clones a template into a new user-owned completed project and returns its new share slug.",
    response_model=CloneTemplateResponse,
    tags=["templates"],
)
async def clone_template_endpoint(slug: str, req: CloneTemplateRequest):
    token = req.access_token or req.auth_token
    if not isinstance(token, str) or not token.strip():
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    has_byok = False
    try:
        key_status = await get_user_llm_key_status(auth_user.user_id)
        has_byok = isinstance(key_status, dict) and key_status.get("has_key") is True
    except Exception:
        has_byok = False

    if not is_admin_email(auth_user.email) and not has_byok:
        try:
            reservation = await check_and_reserve_quota(auth_user.user_id)
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail={"error": "quota_check_failed", "message": "Unable to check generation quota. Please try again."},
            ) from error

        if not reservation.get("ok"):
            err = reservation.get("error", "quota_exhausted")
            if err == "profile_not_found":
                raise HTTPException(
                    status_code=400,
                    detail={"error": "quota_check_failed", "message": "Unable to check generation quota. Please try again."},
                )
            raise HTTPException(
                status_code=400,
                detail={"error": "quota_exhausted", "message": "You've used all available free generations."},
            )

    try:
        cloned = await clone_template_project_for_user(slug, auth_user.user_id)
    except TemplateNotFoundError as error:
        raise HTTPException(status_code=404, detail={"error": "template_not_found", "message": str(error)}) from error
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail={"error": "template_clone_failed", "message": "Unable to clone template."},
        ) from error

    share_slug = cloned.get("share_slug")
    if not isinstance(share_slug, str) or not share_slug.strip():
        raise HTTPException(
            status_code=400,
            detail={"error": "template_clone_failed", "message": "Unable to clone template."},
        )

    return {"share_slug": share_slug}


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

    normalized_model = req.model.strip() if isinstance(req.model, str) else None

    if req.provider == "openrouter" and not normalized_model:
        raise HTTPException(status_code=400, detail={"error": "model_required", "message": "Model is required for OpenRouter."})

    try:
        await validate_llm_api_key(provider=req.provider, api_key=req.api_key.strip(), model=normalized_model)
    except LlmKeyValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={"error": "llm_key_validation_failed", "message": str(error)},
        ) from error

    from llm_keys import save_user_llm_key

    try:
        await save_user_llm_key(auth_user.user_id, req.provider, req.api_key.strip(), normalized_model)
    except RuntimeError as error:
        logger.error("Failed to save LLM key for user %s: %s", auth_user.user_id, error)
        raise HTTPException(
            status_code=500,
            detail={"error": "key_storage_failed", "message": "Server is not configured for BYOK key storage."},
        ) from error

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
