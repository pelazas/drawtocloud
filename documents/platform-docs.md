# DrawToCloud — Platform Documentation

Complete feature reference, generated from the codebase. Keep this in sync as features ship.

---

## 1. Entry Experience

### Describe-App Modal
**Route:** `/`
**Component:** `components/DescribeAppModal/`

Users start generation from the main workspace using the **Describe your app** action in the top bar.

**Modal fields:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| App name | text input | ✓ | — |
| Describe your app | textarea | ✓ | — |
| Regions | multi-select | — | us-east-1 |
| Expected users | card selector | — | 1K–100K/mo |
| Uptime | card selector | — | 99.9% SLA |
| *(Advanced)* Compliance | selector | — | None |
| *(Advanced)* Environment | selector | — | Production |
| *(Advanced)* Compute preference | selector | — | No preference |
| Monthly budget | number | — | — |

---

### Generation Start Flow
1. User fills app context in Describe-App modal and submits
2. `canvasSession.mode = "new"` — canvas mounts, `start_generation` HTTP call fires immediately
3. Normal pipeline: Requirements → Architect (streams diagram) → Coder + Cost Analyst + Description in parallel

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
- Custom node types:
  - `service` for AWS resources
  - `container` for nested infrastructure scopes like Region, VPC, Availability Zone, and Subnet
- Background: dot grid pattern, color `#374151`, 24px gap
- Controls: zoom in/out/fit (dark styled: `bg-gray-800 border-gray-600`)
- MiniMap: bottom-right, dark styled, node colors match category colors

**Node Rendering:**
- Service nodes render as compact AWS resource cards
- Container nodes render as dashed boundary boxes with per-container-type accent colors
- Supported container hierarchy is `Region? -> VPC -> Availability Zone -> Subnet -> services`
- `Region` appears only for multi-region architectures; single-region canvases start at `VPC`
- Subnets support a topology-aware `public` / `private` subtype rendered as a secondary badge/tint
- Child nodes use React Flow parent/extent containment for layout only; users do not drag them between containers directly

**Node Auto-Layout:**
- Uses dagre-based auto-layout
- Supports nested container sizing by laying out child scopes before parent scopes
- Auto Layout recomputes container dimensions to fit their contents

**Canvas Edits:**
- Users can click nodes to select chat context
- Users can resize selected containers from the corner handles
- Container resize is visual-only and is not persisted as an architectural change
- Chat is the only way to add, remove, rename, or otherwise re-architect the diagram
- Approved architectural changes still update the persisted project graph used for Terraform generation

---

## 3. WebSocket Protocol

**Endpoint:** `ws://localhost:8000/ws` (configured via `NEXT_PUBLIC_WS_URL`)

**Client → Server messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `start_generation` | `{ answers, access_token, project_id? }` | Begin generation from pre-gen form answers |
| `subscribe_project` | `{ project_id, access_token }` | Re-subscribe to an existing project's event stream |
| `chat` | `{ message, access_token, project_id, selected_node_ids? }` | User message for Q&A or edit intents; optional node scope is persisted with the message |
| `canvas_edit` | `{ action: "add_node"\|"remove_node"\|"rename_node", id?, label?, category?, access_token, project_id }` | Legacy structural mutation message; current canvas UX routes architecture changes through chat plans instead |
| `generate_terraform` | `{ project_id, access_token }` | Manually trigger coder-only Terraform regeneration from current canvas nodes |

**Server → Client messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `project_ready` | `{ project_id, share_slug }` | New project created; frontend should update URL |
| `generation_snapshot` | `{ project_id, project_mode, generation_status, generation_stage, generation_error, generation_trace_id, generation_started_at, generation_completed_at, last_event_at, terraform_outdated, setup_pdf_outdated, terraform_generated_at, architecture_modified_at }` | Snapshot for subscribe/reconnect; includes outdated flags for terraform and PDF |
| `diagram_event` | `{ action: "add_node"\|"add_edge", id, label, category, node_type?, container_type?, subnet_kind?, parent_id?, position?, style?, project_id, trace_id }` | Live canvas update; consumed incrementally |
| `agent_log` | `{ agent, message, elapsed, duration_ms, trace_id?, details?, project_id? }` | Agent lifecycle/progress breadcrumb shown in activity feed and correlated backend logs |
| `chat_reply` | `{ message, project_id, execution_mode?, plan_ready?: bool, plan_meta?: {...} }` | Assistant message for Q&A/refactor loop; `plan_ready: true` marks an approvable architecture proposal |
| `chat_reply_delta` | `{ delta, project_id }` | Streaming chunk for assistant message |
| `chat_reply_done` | `{ message, project_id, execution_mode?, plan_ready?: bool, plan_meta?: {...} }` | Final assembled message after streaming; for node_patch plans, plan_meta includes detailed changes (nodes_added, nodes_edited, nodes_deleted, edges_added, edges_deleted, reasoning) |
| `ping` | `{ ts }` | Server keepalive heartbeat; frontend updates connection liveness but does not surface to app handlers |
| `terraform_file` | `{ filename, content, description, project_id, trace_id }` | A single generated Terraform file |
| `cost_estimate` | `{ region, monthly_total: float, items: [...], project_id, trace_id }` | Cost breakdown per node with estimated/fixed monthly pricing |
| `arch_description` | `{ sections: {...}, project_id, trace_id }` | Plain-English architecture description |
| `setup_pdf_status` | `{ setup_pdf_status, setup_pdf_progress, setup_pdf_error?, setup_pdf_generated_at?, project_id }` | Setup PDF generation progress + terminal state |
| `error` | `{ error: "unauthenticated"\|"invalid_json"\|..., message }` | Error event |
| `done` | `{ project_id, trace_id }` | Signals end of generation event stream |

**Connection behavior:**
- Singleton WS client (`lib/websocket.ts`) auto-reconnects after 2s on close
- Multiple `onMessage` subscribers supported; each returns an unsubscribe function
- Backend emits keepalive `ping` messages every 20s to prevent idle disconnects during quiet periods

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
Describe-app modal answers
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
| Cost Analyst | blueprint + diagram_nodes | `{ region, monthly_total: float, items: [...] }` |
| Description | blueprint + diagram_nodes | `{ sections: {...} }` arch description |

**Cost estimate semantics:**
- Structural network containers (`region`, `vpc`, `az`, `subnet`) are diagram scaffolding and do not add monthly cost by themselves.
- When AWS Pricing API data is unavailable or a node lacks exact sizing metadata, the backend uses conservative low-usage defaults for `estimated: true` items.
- Explicitly billable network services such as NAT Gateway still receive non-zero fallback estimates.

---

## 6. Chat-Driven Refactor Plans

### Architecture Refactor Flow
For architecture-wide optimization requests, chat follows an iterative loop:
1. Analyze current cost drivers from available `cost_estimate` data.
2. Ask for missing workload assumptions (requests, active users, traffic) when needed.
3. Return revised pricing + architecture options.
4. Mark an approvable option with `plan_ready: true` + `plan_meta`.

Frontend then surfaces the approval button and sends `chat_plan_approve` when accepted.
The backend runs the architecture update and streams the refreshed diagram and pricing to the same project.

### Node Patch (Infrastructure Change) Flow
For targeted infrastructure changes (e.g., "add Redis cache", "remove S3 bucket"):
1. User sends change request via chat
2. Backend runs mutation agent and generates detailed plan showing:
   - Nodes to be added/edited/deleted
   - Edges to be added/removed
   - Reasoning for the changes
3. Frontend displays plan with "Apply this change" button
4. User clicks "Apply"
5. Backend:
   - Applies the graph mutation
   - Updates `architecture_modified_at` timestamp
   - Recomputes **Cost Analyst** estimate from the updated graph
   - Does NOT run Coder agent automatically
6. Terraform viewer shows "Outdated" banner until user manually clicks "Generate Terraform"

**Plan details in `chat_reply_done` for node_patch:**
```json
{
  "type": "chat_reply_done",
  "plan_ready": true,
  "plan_meta": {
    "plan_id": "uuid",
    "type": "node_patch",
    "status": "pending",
    "details": {
      "nodes_added": [{"id": "redis_1", "label": "Redis", "category": "database"}],
      "nodes_edited": [],
      "nodes_deleted": [],
      "edges_added": [{"from": "ecs", "to": "redis_1", "label": "caches"}],
      "edges_deleted": [],
      "reasoning": "Adding Redis as a caching layer to reduce database load"
    }
  }
}
```

---

## 7. Output Panel

**Component:** `components/OutputPanel.tsx`

**Tabs:**
- **Terraform** — displays generated `.tf` files with syntax highlighting; download button for `.zip`
- **Cost estimate** — monthly total + per-service breakdown from Cost Analyst agent
- **Description** — plain-English architecture walkthrough from Description agent

**Terraform Tab:**
- Displays generated `.tf` files with syntax highlighting
- Download button for individual files
- **Outdated indicator:** When `terraform_outdated: true` in `generation_snapshot`, shows amber banner:
  - "Architecture has changed. Terraform code is outdated."
  - "Generate Terraform" button to trigger Coder agent manually
- Terraform files are NOT regenerated automatically when architecture changes via chat mutation

**Bottom setup PDF action (owner view only):**
- Full-width action at panel bottom
- States:
  - `Generate setup PDF` (enabled only after pipeline completed)
  - `Generating setup PDF` with 0-100 progress bar
  - `Download setup PDF` on success
  - `PDF outdated` with `Regenerate`
  - `Retry` with error message on failure

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
| POST | `/api/generations/start` | Start a new generation (auth required; returns `project_id`, `trace_id`) |
| POST | `/api/projects` | Create a named empty project (auth required) |
| PATCH | `/api/projects/{project_id}` | Update mutable project metadata (`title`) for an owned project (auth required) |
| PATCH | `/api/projects/{project_id}/snapshot` | Save canvas nodes/edges snapshot for an owned project (auth required) |
| POST | `/api/projects/{project_id}/setup-pdf/generate` | Start setup PDF generation (auth required) |
| GET | `/api/projects/{project_id}/setup-pdf/download` | Get signed setup PDF download URL (auth required) |
| GET | `/api/me/entitlements` | Returns `{ is_admin: bool }` for the authenticated user |
| POST | `/api/llm-key` | Save encrypted BYOK provider key for authenticated user |
| GET | `/api/llm-key` | Fetch BYOK key status (`has_key`, provider, model) |
| DELETE | `/api/llm-key` | Delete authenticated user's stored BYOK key |
| WS | `/ws` | Main WebSocket connection |

All endpoints documented via FastAPI's native tooling (summary, description, response_model, tags).

### Save Flow (Issue #150)

- Clicking Save now always opens the naming modal when the project is new or owned by the current user.
- Existing owned projects open the modal pre-filled with current title, enabling rename-on-save.
- If the submitted name changed, frontend calls `PATCH /api/projects/{project_id}` before snapshot persistence.

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
