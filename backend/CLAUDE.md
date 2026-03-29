# Backend — DrawToCloud

FastAPI (Python 3.12), Claude SDK, WebSockets.

## Stack
- **Framework:** FastAPI
- **Runtime:** Python 3.12 via `uv` (`.venv` uses 3.12 despite 3.11 in Dockerfile)
- **LLM:** Anthropic Claude SDK (+ OpenRouter / OpenAI fallback)
- **Transport:** WebSockets

## Key Files
```
main.py          # FastAPI app entry point
ws_handler.py    # WebSocket orchestration
llm_client.py    # unified provider client (Anthropic / OpenRouter / OpenAI)
agents/
  requirements.py    # extracts structured requirements from pre-gen form answers
  architect.py       # streams diagram events
  coder.py           # generates Terraform files
  chat_agent.py      # chat replies for architecture Q&A
```

## Agent Pipeline
```
User message → Requirements Agent → Architect Agent (streams events)
                                          ↓             ↓
                                    Coder Agent   Description Agent  (parallel)
```

## Streaming Rule
The Architect agent **MUST** stream diagram events one at a time via WebSocket — never batch them.

## API Key Handling
- Default provider keys can be loaded from server env vars (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)
- BYOK flow: authenticated users can save keys via `POST /api/llm-key`, status-check via `GET /api/llm-key`, and delete via `DELETE /api/llm-key`
- BYOK keys are encrypted using Fernet and `LLM_KEY_ENCRYPTION_SECRET` before storage
- Generation/chat resolves per-user BYOK credentials first; env vars are fallback only
- Non-admin users with BYOK bypass quota enforcement and quota increments
- Auth is via Supabase `access_token` in every HTTP/WS request

## Model Routing
```python
PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "anthropic/claude-3.5-sonnet",
    "openai": "gpt-4o"
}
```

## Documentation Rule
Every endpoint must be documented with FastAPI's built-in tooling:
- **HTTP routes:** `summary`, `description`, `response_model`, `responses` on the decorator
- **WebSocket:** docstring listing accepted message types and emitted events
- Tag endpoints by domain: `tags=["health"]`, `tags=["websocket"]`

## WebSocket Message Types

**Client → Server:**
```json
{ "type": "start_generation", "answers": {...}, "access_token": "..." }
{ "type": "chat", "message": "...", "access_token": "...", "project_id": "..." }
{ "type": "canvas_edit", "action": "remove_node", "id": "rds", "access_token": "...", "project_id": "..." }
{ "type": "estimate_cost", "nodes": [...], "access_token": "..." }
{ "type": "generate_terraform", "project_id": "...", "access_token": "..." }
{ "type": "subscribe_project", "project_id": "...", "access_token": "..." }
```

**Server → Client:**
```json
{ "type": "project_ready", "project_id": "...", "share_slug": "..." }
{ "type": "diagram_event", "action": "add_node", ... }
{ "type": "terraform_file", "filename": "main.tf", "content": "...", "project_id": "...", "trace_id": "..." }
{ "type": "arch_description", "sections": {...}, "project_id": "...", "trace_id": "..." }
{ "type": "chat_reply", "message": "...", "project_id": "...", "plan_ready": false }
{ "type": "chat_reply_delta", "delta": "...", "project_id": "..." }
{ "type": "chat_reply_done", "message": "...", "project_id": "...", "plan_ready": true }
{ "type": "error", "error": "unauthenticated|invalid_token|...", "message": "..." }
{ "type": "done", "project_id": "...", "trace_id": "..." }
```

## Agent Output Rules
- System prompts must enforce **valid JSON only** — no prose in agent responses
- Architect agent output: sequence of `diagram_event` JSON objects
- Coder agent output: `{ "files": { "main.tf": "...", ... } }`

## Deployment Constraint: Single Worker

**IMPORTANT:** This backend uses in-memory state (`ProjectBroadcaster`, `_RUNNING_TASKS`, `_RUNTIMES`). Multi-worker deployments will silently break WebSocket message delivery — clients subscribed to one worker will not receive events from another.

**Requirement:** Set `WEB_CONCURRENCY=1` in all deployments. The startup handler enforces this.

**V1 fix:** Replace in-memory broadcaster with Redis pub/sub.

## Constraints
- **Never deploy actual AWS infrastructure**
- No auth in MVP — anonymous Supabase links only
- All agents use the same provider/key the user configured

## Dev
```bash
cd backend && uv run uvicorn main:app --reload
```
