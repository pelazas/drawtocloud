# DrawToCloud — Copilot Agent Instructions

DrawToCloud is a conversational AWS infrastructure designer. Users describe their app → multi-agent AI pipeline → live React Flow canvas builds in real-time → Terraform export + cost estimate.

---

## Required reading before ANY code change

Read these files before writing a single line of code. Skipping them causes compliance violations that block merges.

| File | Why |
|------|-----|
| `CLAUDE.md` (root) | Mandatory rules, full WS protocol, agent pipeline |
| `backend/CLAUDE.md` | Backend-specific rules |
| `frontend/CLAUDE.md` | Frontend-specific rules |
| `documents/platform-docs.md` | Every feature, endpoint, WS message — canonical |
| `documents/data-reference.md` | Data invariants, entity relationships — canonical |
| `documents/styleguide.md` | Colors, spacing, patterns — all UI must comply |

For architectural/complex tasks also read:
- `documents/vision.md` — MVP scope vs. V2+
- `documents/ICPs.md` — features must serve ICP 1 (solo founders) or ICP 2 (DevOps engineers)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), Tailwind CSS, React Flow 11, **pnpm** |
| Backend | FastAPI (Python 3.12), Claude SDK, WebSockets, **uv** package manager |
| Auth | Supabase (email/password + OAuth) |
| Storage | Supabase (projects, shareable links) |
| Cost | AWS Pricing API via boto3 |
| Containers | Docker + docker-compose |

---

## Repository layout

```
drawtocloud/
├── frontend/
│   ├── app/                        # Next.js App Router routes
│   │   ├── page.tsx                # main workspace (TopBar + LeftPanel + Canvas + RightPanel)
│   │   ├── login/page.tsx          # Supabase sign-in
│   │   └── layout.tsx
│   ├── components/                 # UI components (max 150 lines each)
│   │   ├── Canvas/                 # React Flow diagram + custom nodes
│   │   ├── Canvas.tsx
│   │   ├── Chat.tsx
│   │   ├── DescribeAppModal/       # generation-start modal
│   │   ├── OutputPanel.tsx         # Terraform + cost + description tabs
│   │   ├── LeftPanel.tsx
│   │   ├── RightPanel.tsx
│   │   ├── TopBar.tsx
│   │   └── AgentActivityFeed.tsx
│   ├── lib/
│   │   ├── websocket.ts            # WS singleton, auto-reconnect
│   │   ├── useCanvasPipeline.ts    # WS/pipeline state + canvas/chat handlers
│   │   ├── useWorkspace.ts         # workspace-level auth/project/panel orchestration
│   │   ├── categoryColors.ts       # node category → hex color (ONLY import from here)
│   │   ├── projects.ts             # CanvasSession type + persisted project mapping
│   │   ├── projectActions.ts       # reusable project delete hook
│   │   ├── domains.ts              # app-domain and auth-route helpers
│   │   └── storage.ts              # localStorage helpers
│   ├── middleware.ts               # auth middleware + /p/:slug redirect
│   ├── package.json
│   └── CLAUDE.md
├── backend/
│   ├── agents/
│   │   ├── architect.py            # streams diagram_event messages (MUST stream, never batch)
│   │   ├── requirements.py         # extracts structured requirements from form answers
│   │   ├── coder.py                # generates Terraform files
│   │   ├── cost_analyst.py         # AWS Pricing API cost estimation
│   │   ├── description.py          # plain-English architecture description
│   │   ├── chat_agent.py           # chat replies, mutation planning
│   │   ├── mutation_agent.py       # node-patch planner
│   │   ├── mutation_apply.py       # applies approved node-patch plans
│   │   ├── log_helper.py           # emit_log() for agent_log WS messages
│   │   └── utils.py
│   ├── main.py                     # FastAPI app entry point
│   ├── ws_handler.py               # WebSocket orchestration
│   ├── generation_service.py       # full generation pipeline orchestration
│   ├── llm_client.py               # unified Anthropic/OpenRouter/OpenAI client
│   ├── project_store.py            # Supabase project CRUD
│   ├── auth.py                     # verify_access_token_user()
│   ├── quota.py                    # per-user generation quota
│   ├── admin.py                    # is_admin_email()
│   ├── llm_keys.py                 # BYOK encrypted key storage
│   ├── llm_validation.py           # LLM key validation
│   ├── thumbnail_generator.py      # post-generation OG thumbnail
│   ├── setup_pdf_service.py        # setup PDF generation service
│   ├── setup_pdf_generator.py      # PDF rendering
│   ├── supabase_client.py          # shared Supabase client
│   ├── tests/                      # pytest test suite
│   ├── pyproject.toml
│   └── CLAUDE.md
├── documents/
│   ├── platform-docs.md            # CANONICAL: every feature, endpoint, agent, data shape
│   ├── data-reference.md           # CANONICAL: domain data invariants, entity relationships
│   ├── styleguide.md               # color palette, typography, spacing, component patterns
│   ├── vision.md                   # north star and roadmap
│   ├── ICPs.md                     # ideal customer profiles
│   └── plans/                      # per-issue architectural plans (YYYY-MM-DD-<desc>.md)
├── supabase/
│   └── migrations/                 # Supabase SQL migrations
├── docker-compose.yml
├── docker-compose.prod.yml
├── dev.sh                          # tmux dev session (4 panes)
└── CLAUDE.md                       # root — read first
```

---

## Dev commands

```bash
# Backend (Python 3.12, uv)
cd backend && uv run uvicorn main:app --reload

# Frontend (pnpm)
cd frontend && pnpm dev

# Backend tests
cd backend && uv run pytest

# Frontend lint
cd frontend && pnpm lint

# Full stack via Docker
docker-compose up

# tmux dev session (4 panes: backend, frontend, logs, shell)
./dev.sh
```

---

## Environment variables

### Backend — `backend/.env`

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | LLM key (preferred) |
| `OPENAI_API_KEY` | LLM key (fallback) |
| `OPENROUTER_API_KEY` | LLM key (last resort) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Pricing API (cost estimation) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `LLM_KEY_ENCRYPTION_SECRET` | Fernet key for BYOK encryption |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `ADMIN_EMAILS` | Comma-separated admin email list |

### Frontend — `frontend/.env.local`

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_WS_URL` | WebSocket URL (default: `ws://localhost:8000/ws`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

---

## Agent pipeline

```
User fills Describe-App modal
    ↓
[Requirements Agent]
  Input:  answers dict (description, regions, users, uptime, compliance,
                        environment, compute_preference, monthly_budget)
  Output: { app_name, inferred_services, architecture_style, notes }
    ↓
[Architect Agent]  ← MUST stream diagram_event messages ONE AT A TIME via WS
  Input:  requirements JSON
  Output: sequence of diagram_event JSON objects
    ↓ (after architect completes — asyncio.TaskGroup)
  ├─ [Coder Agent]         → terraform_file WS messages
  ├─ [Cost Analyst Agent]  → cost_estimate WS message
  └─ [Description Agent]   → arch_description WS message

Manual Terraform path:
User clicks "Generate Terraform"
    ↓ generate_terraform WS message → Coder Agent → terraform_file WS messages
```

**Critical agent constraints:**
- Architect **MUST** stream events one at a time — never batch, never return all at once
- Coder output shape: `{ "files": { "main.tf": "...", "variables.tf": "...", ... } }`
- All agent system prompts must enforce **valid JSON only** — absolutely no prose in agent responses
- dagre layout runs **once** on the `"done"` event — never during streaming
- All node positions are `{x:0, y:0}` during streaming

---

## WebSocket protocol

### Client → Server

| `type` | Required fields |
|--------|----------------|
| `start_generation` | `answers`, `access_token`, `project_id?` |
| `subscribe_project` | `project_id`, `access_token` |
| `chat` | `message`, `access_token`, `project_id`, `selected_node_ids?` |
| `canvas_edit` | `action` (`add_node`\|`remove_node`\|`rename_node`), `access_token`, `project_id` + action-specific fields |
| `generate_terraform` | `project_id`, `access_token` |
| `estimate_cost` | `nodes`, `access_token` |

### Server → Client

| `type` | Key fields |
|--------|-----------|
| `project_ready` | `project_id`, `share_slug` |
| `generation_snapshot` | Full project state snapshot for reconnect |
| `diagram_event` | `action`, `id`, `label`, `category`, `node_type?`, `container_type?`, `subnet_kind?`, `parent_id?`, `position?`, `style?`, `project_id`, `trace_id` |
| `agent_log` | `agent`, `message`, `elapsed`, `duration_ms`, `trace_id?`, `details?`, `project_id?` |
| `cost_estimate` | `region`, `monthly_total`, `items[]`, `budget_cap?`, `over_budget?`, `project_id`, `trace_id` |
| `terraform_file` | `filename`, `content`, `description`, `project_id`, `trace_id` |
| `arch_description` | `sections: {overview, key_components, tradeoffs, next_steps}`, `project_id`, `trace_id` |
| `chat_reply_delta` | `delta`, `project_id` |
| `chat_reply_done` | `message`, `project_id`, `plan_ready?`, `plan_meta?` |
| `setup_pdf_status` | `setup_pdf_status`, `setup_pdf_progress`, `project_id` |
| `pipeline_event` | `stage`, `event`, `level`, `message`, `details?`, `trace_id`, `project_id` |
| `ping` | `ts` — server keepalive every 20 s; frontend ignores at app level |
| `error` | `error` (`unauthenticated`\|`invalid_json`\|…), `message` |
| `done` | `project_id`, `trace_id` |

**WS messages never carry `api_key` or `provider` fields.**

---

## Authentication rules

- All WS messages and HTTP API calls require a valid Supabase `access_token`
- Backend verifies via `auth.verify_access_token_user(token)` in `auth.py`
- LLM API keys are **server-side env vars only** — never sent to/from the client, never logged
- BYOK: users store encrypted provider keys via `POST /api/llm-key`; stored in Supabase `user_llm_keys` table encrypted with Fernet; `GET /api/llm-key` returns only `{ has_key, provider, model }` — never the plaintext key
- Non-admin BYOK users bypass quota enforcement

---

## HTTP endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | `{ "status": "ok" }` |
| GET | `/health/ready` | No | 200/503 DB probe |
| GET | `/api/templates` | No | List public templates |
| POST | `/api/templates/{slug}/clone` | Yes | Clone template into user project |
| POST | `/api/generations/start` | Yes | Start generation, returns `project_id` |
| POST | `/api/projects` | Yes | Create named empty project |
| PATCH | `/api/projects/{project_id}` | Yes | Update project title |
| PATCH | `/api/projects/{project_id}/snapshot` | Yes | Save canvas nodes/edges |
| POST | `/api/projects/{project_id}/setup-pdf/generate` | Yes | Start setup PDF generation |
| GET | `/api/projects/{project_id}/setup-pdf/download` | Yes | Signed PDF download URL |
| GET | `/api/me/entitlements` | Yes | `{ is_admin: bool }` |
| POST | `/api/llm-key` | Yes | Save encrypted BYOK key |
| GET | `/api/llm-key` | Yes | BYOK key status |
| DELETE | `/api/llm-key` | Yes | Delete BYOK key |
| WS | `/ws` | Yes (token in message) | Main WebSocket |

**Every endpoint must have `summary`, `description`, `response_model`, `responses`, and `tags=[...]` on the decorator. WebSocket handlers must have a docstring listing accepted message types and emitted events.**

---

## Diagram node/edge data shapes

### Node (TypeScript)

```typescript
{
  id: string                          // snake_case, stable (e.g. "vpc", "ecs_cluster")
  type: "service" | "container"
  position: { x: number, y: number }  // {0,0} during streaming; dagre assigns on "done"
  parentId?: string                   // for nested nodes
  extent?: "parent"                   // required when parentId is set
  style?: { width: number, height: number }  // containers only
  data: {
    label: string
    category: string                  // network|compute|database|storage|security|monitoring|default
    containerType?: "region" | "vpc" | "az" | "subnet"
    subnetKind?: "public" | "private"
    nodeType?: string                 // AWS service type hint (e.g. "ecs", "rds")
  }
}
```

**Container hierarchy:** `region` (optional) → `vpc` → `az` → `subnet` → services

### Edge (TypeScript)

```typescript
{
  id: string          // "${source}-${target}"
  source: string
  target: string
  label?: string
  animated: boolean   // always true
  style?: { stroke: string }
}
```

---

## Node category colors

**Always import `colorForCategory` from `frontend/lib/categoryColors.ts`. Never inline hex values.**

| Category | Hex |
|----------|-----|
| `network` | `#3b82f6` |
| `compute` | `#f97316` |
| `database` | `#22c55e` |
| `storage` | `#eab308` |
| `security` | `#ef4444` |
| `monitoring` | `#a855f7` |
| `default` | `#6b7280` |

Container type colors (from `frontend/components/Canvas/containerNodeStyles.ts`):

| Container | Hex |
|-----------|-----|
| `region` | `#8b5cf6` |
| `vpc` | `#3b82f6` |
| `az` | `#6366f1` |
| `subnet` | `#14b8a6` |

---

## Frontend rules (non-negotiable)

1. **Max 150 lines per component.** If a component exceeds this, split it automatically.
2. **Separate UI from logic.** Rendering stays in the `.tsx` file; state, effects, and handlers go into a co-located `use<Name>.ts` hook.
3. All colors come from `documents/styleguide.md` / `categoryColors.ts`. Introducing new hex values without updating `documents/styleguide.md` is a compliance violation.
4. Canvas structural changes (add/remove/rename nodes) happen through chat plans — not direct drag interactions.

---

## Backend rules (non-negative)

1. **Single worker only.** Backend uses in-memory state (`ProjectBroadcaster`, `_RUNNING_TASKS`, `_RUNTIMES`). `WEB_CONCURRENCY=1` is enforced at startup. Multi-worker deployments silently break WebSocket delivery — do not add multi-worker support without the Redis pub/sub migration.
2. **Never deploy actual AWS infrastructure** — even in tests.
3. Agent system prompts must enforce valid JSON output only — no prose allowed.
4. Every new HTTP endpoint needs `summary`, `description`, `response_model`, `responses`, and `tags=[...]`.
5. WebSocket handlers need a docstring listing accepted message types and emitted events.

---

## LLM model routing

```python
PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
    "openai": "gpt-4o",
}
```

Provider priority for server env keys: **Anthropic → OpenAI → OpenRouter** (first found wins).  
Per-user BYOK credentials override env vars at request time.

---

## Data contracts — mandatory update rule

When a change modifies any contract, update the corresponding document **in the same PR**:

| Changed contract | Update this document |
|-----------------|----------------------|
| Agent input/output shape | `documents/data-reference.md` |
| WS message type (add/modify/remove) | `documents/platform-docs.md` §3 AND `documents/data-reference.md` |
| HTTP API shape | `documents/platform-docs.md` §9 |
| UI colors or spacing | `documents/styleguide.md` |
| New feature | Confirm it serves an ICP in `documents/ICPs.md`; if not, note it in `documents/vision.md` |

---

## Bug workflow

1. Write a **failing test** reproducing the bug **before** attempting a fix
2. Confirm the test fails as expected
3. Implement the fix
4. The fix is accepted only when the previously failing test passes

---

## Complex/architectural tasks

If a task requires multi-step planning or involves architectural decisions, write the plan to `documents/plans/YYYY-MM-DD-<short-description>.md` **before** starting implementation.

---

## Key data invariants (never violate)

- Edges must never reference node IDs that don't exist; deleting a node removes all its edges
- `add_edge` diagram events must only reference node IDs already emitted via `add_node`
- Parent containers must be emitted **before** any child node that references them via `parent_id`
- `terraform_outdated` = `architecture_modified_at > terraform_generated_at`; shown as amber banner in UI
- Terraform is **not** regenerated automatically on architecture changes — manual only via `generate_terraform`
- `share_slug` is unique across all projects (DB-level constraint)
- BYOK `encrypted_key` is always Fernet-encrypted; plaintext keys are never stored or returned

---

## `projects` table — key columns (Supabase)

`id`, `user_id`, `title`, `project_mode` (`default`|`discovery`), `nodes` (JSONB), `edges` (JSONB), `terraform_files` (JSONB), `cost_estimate` (JSONB), `chat_history` (JSONB), `share_slug`, `is_template`, `generation_status`, `generation_stage`, `generation_trace_id`, `terraform_generated_at`, `architecture_modified_at`, `thumbnail_url`, `setup_pdf_status`, `setup_pdf_progress`, `last_opened_at`

---

## Out of scope — do NOT implement

These are explicitly planned for future versions. Implementing them in MVP is a scope violation:

| Feature | Planned version |
|---------|----------------|
| AWS account connection / deploy button | V2 |
| Terraform validation (tfsec / terraform validate) | V1 |
| Team collaboration / multiplayer | V2 |
| Drift detection | V3 |
| Light mode | V2 |
| Multi-worker backend (Redis pub/sub) | V1 |
