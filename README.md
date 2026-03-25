# DrawToCloud

DrawToCloud is an AI-assisted AWS architecture builder. Users describe an app, get a live diagram, iterate through chat/canvas edits, and export Terraform with cost and architecture explanations.

## Architecture

- **Frontend**: Next.js 14 (`frontend/`) with App Router, Supabase auth, React Flow canvas.
- **Backend**: FastAPI (`backend/`) with HTTP + WebSocket orchestration and multi-agent generation pipeline.
- **Database/Auth**: Supabase (external project; schema in `supabase/migrations/`).
- **Dev proxy**: Nginx (`proxy/nginx.conf`) routes:
  - `/` -> frontend
  - `/api/*` -> backend
  - `/ws` -> backend websocket

Generation pipeline (backend):
1. Requirements agent
2. Architect agent (streams diagram events)
3. In parallel: Coder (Terraform), Cost Analyst, Description agent

## Repository Layout

- `frontend/`: UI routes, chat/canvas pipeline, auth/session UX
- `backend/`: FastAPI API, websocket protocol, orchestration, agents
- `supabase/migrations/`: SQL schema, RLS policies, RPCs
- `proxy/`: Nginx config for same-origin Docker dev
- `tests/docker/test_compose_proxy.sh`: Docker compose/proxy regression check
- `dev.sh`: tmux-based local dev launcher (frontend + backend)
- `docker-up.sh`: helper to start compose and print app URL

## Prerequisites

Choose either Docker or local runtimes.

- **Docker path**:
  - Docker + Docker Compose
- **Local path**:
  - Python + `uv` (backend)
  - Node.js + `pnpm` (frontend)
  - `tmux` (optional, for `./dev.sh`)

## Environment Variables

Create a root `.env` file for Docker Compose (or set env vars in your shell). Minimum set:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<secret-key>

# At least one provider key unless users will always use BYOK
ANTHROPIC_API_KEY=...
# OPENAI_API_KEY=...
# OPENROUTER_API_KEY=...

# Optional
ADMIN_EMAILS=you@example.com,another@example.com
```

Backend-specific optional vars:

- `ALLOWED_ORIGINS` (default: `http://localhost:3000`)
- `WEB_CONCURRENCY` (must remain `1`)
- `LLM_KEY_ENCRYPTION_SECRET` (required if using BYOK key storage)

Frontend `.env` (for local frontend outside Docker), based on `frontend/.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG=<template-slug>

# Optional domain/feature flags
NEXT_PUBLIC_APP_DOMAIN=app.drawtocloud.com
NEXT_PUBLIC_LANDING_DOMAIN=drawtocloud.com
NEXT_PUBLIC_ENABLE_SOCIAL_AUTH=false
```

## Run With Docker Compose

```bash
# from repo root
docker compose up -d
# or
./docker-up.sh
```

Compose starts `frontend`, `backend`, and `proxy`. Proxy exposes container port 80 on a random host port.

Find URL:

```bash
docker compose port proxy 80
```

## Run Locally (Without Docker)

### Option A: one-command tmux launcher

```bash
./dev.sh
```

### Option B: manual terminals

Backend:

```bash
cd backend
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude '.venv/*' --reload-exclude '.pytest_cache/*' --reload-exclude '__pycache__/*'
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev
```

## Testing

Backend tests:

```bash
cd backend
uv run pytest
```

Docker/proxy config check:

```bash
bash tests/docker/test_compose_proxy.sh
```

Frontend currently has lint/build scripts but no test script:

```bash
cd frontend
pnpm lint
pnpm build
```

## Supabase Migrations

Schema and RPC definitions are in `supabase/migrations/`.

Notable database capabilities defined there include:

- `profiles`, `projects`, and `user_llm_keys` tables
- RLS policies for ownership/public sharing
- Atomic RPC helpers like `append_chat_message` and `check_and_reserve_quota`

Apply migrations using your Supabase workflow (CLI or SQL editor) against your project before running the app.

## API Surface (High Level)

HTTP endpoints (backend):

- `GET /health`
- `GET /health/ready`
- `POST /api/questionnaire`
- `POST /api/generations/start`
- `GET /api/me/entitlements`
- `POST /api/llm-key`
- `GET /api/llm-key`
- `DELETE /api/llm-key`

WebSocket endpoint:

- `/ws`

## Operational Notes

- Backend is intentionally **single-worker**. Multi-worker (`WEB_CONCURRENCY > 1` or `uvicorn --workers > 1`) is blocked because in-memory runtime/subscriber state is used.
- Cost analyst can use `infracost` when available and falls back when unavailable.
- Share pages are public by slug (`/p/[slug]`) while edit capabilities depend on ownership/auth.

## Known Gaps

- `backend/README.md` is empty and `frontend/README.md` is still boilerplate; this root README is the main project entry.
- Frontend has no automated test suite configured in `package.json`.
- There is a Python version mismatch to resolve: `backend/pyproject.toml` requires `>=3.12` while `backend/Dockerfile.dev` currently uses `python:3.11-slim`.
