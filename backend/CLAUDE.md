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
  requirements.py   # extracts structured requirements from user message
  architect.py      # streams diagram events
  coder.py          # generates Terraform files
  cost_analyst.py   # produces cost breakdown JSON
```

## Agent Pipeline
```
User message → Requirements Agent → Architect Agent (streams events)
                                          ↓             ↓
                                    Coder Agent   Cost Analyst Agent  (parallel)
```

## Streaming Rule
The Architect agent **MUST** stream diagram events one at a time via WebSocket — never batch them.

## API Key Handling
- Key is received per-request in the WS payload: `{ "api_key": "...", "provider": "..." }`
- **Never log or store the key** — use it for the current request only
- Return `{ "error": "invalid_api_key", "provider": "..." }` on auth failure

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
{ "type": "chat", "message": "...", "api_key": "sk-...", "provider": "anthropic" }
{ "type": "canvas_edit", "action": "remove_node", "id": "rds", "api_key": "...", "provider": "..." }
{ "type": "canvas_edit", "action": "add_node", "label": "Redis", "category": "database", "api_key": "...", "provider": "..." }
```

**Server → Client:**
```json
{ "type": "diagram_event", "action": "add_node", ... }
{ "type": "terraform", "files": { "main.tf": "...", "variables.tf": "..." } }
{ "type": "cost_estimate", "monthly_total": 142.50, "breakdown": [...] }
{ "type": "chat_reply", "message": "..." }
{ "type": "error", "error": "invalid_api_key", "provider": "anthropic" }
{ "type": "done" }
```

## Agent Output Rules
- System prompts must enforce **valid JSON only** — no prose in agent responses
- Architect agent output: sequence of `diagram_event` JSON objects
- Coder agent output: `{ "files": { "main.tf": "...", ... } }`
- Cost Analyst output: `{ "monthly_total": float, "breakdown": [...] }`

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
