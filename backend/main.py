import json
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import verify_access_token
from generation_service import GenerationStartError, start_generation_for_user
from ws_handler import handle_websocket

app = FastAPI(title="DrawToCloud API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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

    user_id = verify_access_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    try:
        result = await start_generation_for_user(user_id, req.answers, req.project_id)
    except GenerationStartError as error:
        raise HTTPException(status_code=400, detail={"error": error.code, "message": error.message}) from error

    return {
        "project_id": str(result["project_id"]),
        "share_slug": result.get("share_slug") if isinstance(result.get("share_slug"), str) else None,
        "trace_id": str(result["trace_id"]),
        "generation_status": str(result["generation_status"]),
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Main WebSocket endpoint for real-time diagram collaboration.

    Accepted client message types:
    - `chat`        — { type, message, access_token|auth_token, project_id?, api_key?, provider? }
                      Triggers the agent pipeline; streams diagram_event messages.
    - `canvas_edit` — { type, action, id/label/category, access_token|auth_token, project_id?, api_key?, provider? }
                      Triggers full Terraform regeneration (stub in MVP).

    Emitted server message types:
    - `diagram_event` — { type, action, id, label, category } or { type, action, from, to, label }
    - `terraform`     — { type, files: { "main.tf": "...", ... } }
    - `cost_estimate` — { type, monthly_total, breakdown }
    - `chat_reply`    — { type, message }
    - `error`         — { type, error, provider? }
    - `done`          — { type }
    """
    await ws.accept()
    try:
        await handle_websocket(ws)
    except WebSocketDisconnect:
        pass
