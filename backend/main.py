from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel

from ws_handler import handle_websocket

load_dotenv()

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


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Main WebSocket endpoint for real-time diagram collaboration.

    Accepted client message types:
    - `chat`        — { type, message, api_key, provider }
                      Triggers the agent pipeline; streams diagram_event messages.
    - `canvas_edit` — { type, action, id/label/category, api_key, provider }
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
