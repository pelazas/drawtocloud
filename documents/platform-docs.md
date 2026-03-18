# DrawToCloud — Platform Documentation

Complete feature reference, generated from the codebase. Keep this in sync as features ship.

---

## 1. Entry Experience

### Pre-Generation Form
**Route:** `/new`
**Component:** `components/PreGenForm/`

A single-screen form that replaces the old multi-step questionnaire. Two submission paths depending on whether the user fills in a description.

**Form fields:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| Project name | text input | ✓ | — |
| Describe your app | textarea | — | — |
| Region | button-group | — | us-east-1 |
| Expected users | button-group | — | 1K–100K/mo |
| Uptime | button-group | — | 99.9% SLA |
| *(Advanced)* Compliance | button-group | — | None |
| *(Advanced)* Environment | button-group | — | Production |
| *(Advanced)* Compute preference | button-group | — | No preference |

**AI Prompt Helper** (collapsible, below description textarea):
- Displays a copyable structured prompt the user pastes into Claude Code or any AI with codebase access
- Paste-back textarea + "Apply" button fills the description field

**Submit button label:**
- Description filled → **"Generate Architecture"** → fast path
- Description empty → **"Start Designing"** → chat-first discovery path

---

### Fast Path (description provided)
1. User fills name + description + selectors → clicks "Generate Architecture"
2. `canvasSession.mode = "new"` — canvas mounts, `start_generation` HTTP call fires immediately
3. Normal pipeline: Requirements → Architect (streams diagram) → Coder + Cost Analyst + Description in parallel

### Chat-First Discovery Path (no description)
1. User fills name + selectors only → clicks "Start Designing"
2. Frontend starts a discovery session (reusing `project_id` when available) and resolves `project_id + share_slug`
3. Frontend redirects immediately to `/p/{share_slug}` (canonical project route)
4. Project opens in discovery mode (`project_mode = "discovery"`, `generation_stage = "discovery"`)
5. AI asks questions one at a time (4–6 exchanges), then presents a structured architecture plan
6. Plan message has `plan_ready: true` → frontend renders **"Accept & Generate"** button below it
7. Clicking "Accept & Generate" calls `triggerGeneration()` → sends `start_generation` with `conversation_summary`
8. Generation start transitions project mode to `default`; normal pipeline runs from this point forward

---

## 2. Canvas Screen

**Layout:** Full-screen split — chat panel (left, fixed 320px) + diagram canvas (center/right, flex-1)

### 2.1 Chat Panel

**Component:** `components/Chat.tsx`

- Header: "DrawToCloud" title + "Describe your infrastructure" subtitle
- Message history: scrollable, auto-scrolls to latest on new messages
- Message bubbles:
  - User: right-aligned, blue background (`bg-blue-600`)
  - Assistant: left-aligned, dark gray (`bg-gray-700`)
- Input: text field + send button (arrow icon from lucide-react)
- Button disabled while a response is in flight
- Empty state: placeholder copy shown until first message

**Behavior:**
- On send, the message is immediately added to local state as a user bubble
- The message is dispatched over the WebSocket as `{ type: "chat", message, api_key, provider }`
- Incoming `chat_reply` events populate assistant bubbles
- A `done` event re-enables the send button

### 2.2 Diagram Canvas

**Component:** `components/Canvas.tsx`

- Renders a React Flow 11 canvas with dark background (`bg-gray-950`)
- Custom node type `"custom"` uses `NodeLabel` component
- Background: dot grid pattern, color `#374151`, 24px gap
- Controls: zoom in/out/fit (dark styled: `bg-gray-800 border-gray-600`)
- MiniMap: bottom-right, dark styled, node colors match category colors

**Node Rendering (NodeLabel):**
- Each node is a pill/card: `px-3 py-2 rounded-lg text-white text-sm font-medium shadow-md min-w-[120px] text-center`
- Background color is determined by `colorForCategory(data.category)` (see Style Guide)
- Nodes are draggable (React Flow default)

**Node Auto-Layout:**
- Nodes arriving from WebSocket events are placed in a 3-column grid
- Position formula: `x = 100 + (index % 3) * 220`, `y = 100 + Math.floor(index / 3) * 140`
- `nodeCounter` is a module-level counter (resets on hot reload; acceptable for MVP)

**Canvas Edits:**
- Users can drag nodes to reposition them (React Flow native)
- Add / remove / rename nodes sends a `canvas_edit` WS message
- Any canvas edit triggers **full Terraform regeneration** (no diff in MVP)

---

## 3. WebSocket Protocol

**Endpoint:** `ws://localhost:8000/ws` (configured via `NEXT_PUBLIC_WS_URL`)

**Client → Server messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `start_generation` | `{ answers, access_token, project_id? }` | Begin generation from pre-gen form answers |
| `chat_discovery_start` | `{ app_name, regions, expected_users, uptime, compliance?, environment?, compute_preference?, monthly_budget?, access_token, project_id? }` | Start chat-first discovery — creates project in discovery mode, triggers opening question |
| `subscribe_project` | `{ project_id, access_token }` | Re-subscribe to an existing project's event stream |
| `chat` | `{ message, access_token, project_id }` | User message in post-generation chat OR discovery interview |
| `canvas_edit` | `{ action: "add_node"\|"remove_node"\|"rename_node", id?, label?, category?, access_token, project_id }` | Canvas mutation; triggers full Terraform regeneration |

**Server → Client messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `project_ready` | `{ project_id, share_slug }` | New project created; frontend should update URL |
| `generation_snapshot` | `{ project_id, project_mode, generation_status, generation_stage, generation_error, generation_trace_id, generation_started_at, generation_completed_at, last_event_at }` | Snapshot for subscribe/reconnect, including persisted discovery/default mode |
| `diagram_event` | `{ action: "add_node"\|"add_edge", id, label, category, project_id, trace_id }` | Live canvas update; consumed incrementally |
| `chat_reply` | `{ message, project_id, plan_ready?: bool }` | Assistant message; `plan_ready: true` triggers "Accept & Generate" button |
| `chat_reply_delta` | `{ delta, project_id }` | Streaming chunk for assistant message |
| `chat_reply_done` | `{ message, project_id, plan_ready?: bool }` | Final assembled message after streaming |
| `terraform_file` | `{ filename, content, description, project_id, trace_id }` | A single generated Terraform file |
| `cost_estimate` | `{ monthly_total: float, breakdown: [...], project_id, trace_id }` | Cost breakdown per service |
| `arch_description` | `{ sections: {...}, project_id, trace_id }` | Plain-English architecture description |
| `error` | `{ error: "unauthenticated"\|"invalid_json"\|..., message }` | Error event |
| `done` | `{ project_id, trace_id }` | Signals end of generation event stream |

**Connection behavior:**
- Singleton WS client (`lib/websocket.ts`) auto-reconnects after 2s on close
- Multiple `onMessage` subscribers supported; each returns an unsubscribe function

---

## 4. Authentication

**Auth provider:** Supabase Auth — email/password and OAuth (Google, GitHub).

**Flow:**
1. User signs up or logs in via `/register` or `/login`
2. Supabase session is maintained in the browser via `@supabase/ssr`
3. Every WS message and API call includes the `access_token` from the active Supabase session
4. Backend verifies the token on every request via `verify_access_token_user(token)` in `auth.py`
5. Unauthenticated requests → backend emits `{ type: "error", error: "unauthenticated", message: "Missing access token." }`

**LLM keys:** Users can optionally store BYOK credentials via `/api/llm-key`. Keys are encrypted server-side and never returned to the client.

---

## 4.1 BYOK (Bring Your Own Key)

**Goal:** Quota-exhausted users can continue generating by storing their own provider key.

**Storage model:**
- Supabase table: `user_llm_keys`
- Columns: `user_id` (unique), `provider`, `encrypted_key`, `model`, timestamps
- Encryption: Fernet with `LLM_KEY_ENCRYPTION_SECRET`

**API endpoints:**
- `POST /api/llm-key` -> save encrypted key (`provider`, `api_key`, optional `model`)
- `GET /api/llm-key` -> return `{ has_key, provider, model }`
- `DELETE /api/llm-key` -> delete stored key

**Runtime behavior:**
- Generation pipeline and chat resolve `llm_creds` per user when available
- BYOK credentials override env-provider credentials for that request
- Non-admin users with BYOK skip quota enforcement and usage increment

---

## 5. Agent Pipeline

```
Pre-gen form answers (fast path) or conversation summary (chat-first path)
      ↓
[Requirements Agent]        → { app_name, inferred_services, architecture_style, notes }
      ↓
[Architect Agent]           → streams diagram_event messages via WebSocket (sequential, live canvas build)
      ↓
      ├──────────────────────┬────────────────────────┐
      ↓                      ↓                        ↓
[Coder Agent]    [Cost Analyst Agent]    [Description Agent]    ← asyncio.TaskGroup (parallel)
      ↓                      ↓                        ↓
terraform_file          cost_estimate           arch_description
WS messages             WS message              WS message
```

**Streaming rule:** Architect agent MUST emit events one at a time, never batch. Frontend consumes and applies each event to React Flow state immediately.

**Sequencing:** Architect runs first and completes before the parallel group starts. `diagram_nodes` captured after architect are passed into coder, cost_analyst, and description agents. If any parallel agent fails, `asyncio.TaskGroup` cancels the others.

**Agent output contracts:**

| Agent | Input | Output |
|-------|-------|--------|
| Requirements | answers dict (description or conversation_summary + selectors) | `{ app_name, inferred_services, architecture_style, notes }` |
| Architect | requirements JSON | stream of `diagram_event` JSON objects |
| Coder | blueprint + diagram_nodes | `terraform_file` WS messages (streamed per file) |
| Cost Analyst | blueprint + diagram_nodes | `{ monthly_total: float, breakdown: [...] }` |
| Description | blueprint + diagram_nodes | `{ sections: {...} }` arch description |
| Discovery | user message + history + answers | streamed reply; `plan_ready=True` sentinel when plan presented |

---

## 6. Discovery Agent

**File:** `backend/agents/discovery_agent.py`
**Triggered by:** `chat_discovery_start` WS message (chat-first path only)

Conducts a structured interview to gather application context before generation.

**Behavior:**
- Asks one question at a time (conversational, one sentence each)
- Suggested sequence: what does app do → data sensitivity → real-time/jobs/storage → peak traffic → integrations
- After 4+ user answers with sufficient context, presents a structured architecture plan
- Wraps plan in `===ARCHITECTURE_PLAN=== ... ===END_PLAN===` markers; backend strips markers and sets `plan_ready: True`
- Responds to intent signals ("generate", "looks good", "accept") by presenting plan early

**`detect_plan_ready(response_text) → (cleaned_message, bool)`:** strips markers, returns `plan_ready=True` when plan present.

---

## 7. Output Panel

**Component:** `components/OutputPanel.tsx`

**Tabs:**
- **Terraform** — displays generated `.tf` files with syntax highlighting; download button for `.zip`
- **Cost estimate** — monthly total + per-service breakdown from Cost Analyst agent
- **Description** — plain-English architecture walkthrough from Description agent

---

## 8. Shareable Links

**Status:** Planned (next milestone)
**Implementation:** Supabase storage — auth required
- Canvas state serialized and stored as a document linked to the user's account
- Short URL generated and copied to clipboard
- Links are persistent; tied to a project record

---

## 9. HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{ "status": "ok" }` |
| GET | `/health/ready` | Returns 200 when Supabase is reachable; 503 otherwise (load balancer probe) |
| GET | `/api/templates` | Returns public template metadata (`title`, `share_slug`, `thumbnail_url`) for the dashboard modal |
| POST | `/api/templates/{slug}/clone` | Auth-required clone of a template into a new user-owned `completed` project; returns `{ share_slug }` |
| POST | `/api/generations/discovery-start` | Create or resume a discovery-mode project and return canonical `project_id` + `share_slug` |
| POST | `/api/generations/start` | Start a new generation (auth required; returns `project_id`, `trace_id`) |
| GET | `/api/me/entitlements` | Returns `{ is_admin: bool }` for the authenticated user |
| POST | `/api/llm-key` | Save encrypted BYOK provider key for authenticated user |
| GET | `/api/llm-key` | Fetch BYOK key status (`has_key`, provider, model) |
| DELETE | `/api/llm-key` | Delete authenticated user's stored BYOK key |
| WS | `/ws` | Main WebSocket connection |

All endpoints documented via FastAPI's native tooling (summary, description, response_model, tags).

---

## 10. Infrastructure & Dev

**Dev server:** `./dev.sh` → tmux session, 4 panes (backend, frontend, logs, shell)
**Docker:** `docker-compose up` — frontend on :3000, backend on :8000
**Frontend tests:** `pnpm lint` (ESLint)
**Backend tests:** `cd backend && uv run pytest`

**Environment variables:**
| Var | Side | Description |
|-----|------|-------------|
| `NEXT_PUBLIC_WS_URL` | Frontend | WebSocket URL (default: `ws://localhost:8000/ws`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | Supabase anon key |
| `SUPABASE_URL` | Backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Supabase service role key (server auth verification) |
| `LLM_KEY_ENCRYPTION_SECRET` | Backend | Secret used to derive Fernet key for BYOK encryption |
| `ANTHROPIC_API_KEY` | Backend | LLM key — Anthropic |
| `OPENAI_API_KEY` | Backend | LLM key — OpenAI |
| `OPENROUTER_API_KEY` | Backend | LLM key — OpenRouter |
| `CORS_ORIGINS` | Backend | Comma-separated allowed origins (e.g. `http://localhost:3000`) |
