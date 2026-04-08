# DrawToCloud — Data Reference

Domain data relationships, invariants, and non-obvious constraints that are not expressed in TypeScript types or Python models. Read this before touching data flow logic.

---

## 1. Core Entities

### Diagram
A diagram is the user's current canvas state. It is not persisted server-side in MVP (lives in React state only). It becomes persistent in TICKET-004 via Supabase anonymous storage.

A diagram consists of:
- A set of **nodes** (AWS services)
- A set of **edges** (relationships between services)
- A set of **questionnaire answers** (the context that generated it)

**Invariant:** Edges can only reference node IDs that exist. Frontend must not allow dangling edges. When a node is deleted, all edges referencing its ID must be removed too.

### Node
```typescript
{
  id: string             // unique within the diagram; usually the service short name (e.g. "vpc", "rds")
  type: "service" | "container"  // React Flow node type; "container" for VPC only, "service" for all other nodes
  position: { x, y }    // auto-placed by grid formula; user can drag to override
  data: {
    label: string        // human-readable service name (e.g. "RDS PostgreSQL")
    category: string     // determines color; must be one of the 6 known categories or "default"
  }
}
```

**ID rules:**
- IDs come from the Architect agent's `diagram_event` payloads
- They are short, snake_case service identifiers: `vpc`, `alb`, `ecs`, `rds`, `s3`, `elasticache`
- IDs must be stable — if the user edits a node label, the ID does not change
- When a user manually adds a node on the canvas, the frontend generates an ID from the label: lowercase, spaces → underscores, deduplicated with a counter if needed

### Edge
```typescript
{
  id: string             // generated: "${from}-${to}"
  source: string         // node ID
  target: string         // node ID
  label?: string         // relationship description (e.g. "routes to", "reads/writes")
  animated: boolean      // always true for data-flow edges in MVP
  style?: { stroke: string }  // uses source node's category color for visual clarity
}
```

**Constraint:** Edges are directed (source → target). The Architect agent defines directionality semantically (traffic flows from ALB → ECS → RDS, not the reverse).

### ChatMessage
```typescript
{
  role: "user" | "assistant"
  content: string
  execution_mode?: "node_patch" | "architecture_refactor" | "plan_only" | "chat_only"
  planReady?: boolean
  planMeta?: {
    plan_id?: string
    type?: string
    status?: "pending" | "approved" | "executed" | "rejected" | "cancelled"
    requested_change?: string
    details?: {
      nodes_added: Array<{ id: string; label: string; category?: string }>
      nodes_edited: Array<{ id: string; label: string; category?: string }>
      nodes_deleted: Array<{ id: string; label: string; category?: string }>
      edges_added: Array<{ from: string; to: string; label?: string }>
      edges_deleted: Array<{ from: string; to: string; label?: string }>
      reasoning?: string
    }
  }
}
```

**Relationship to diagram:** Chat messages are persisted in `projects.chat_history` with optional metadata (`execution_mode`, `planReady`, `planMeta`). Architecture-wide optimization proposals use `planReady + planMeta` to track which proposal can be approved for generation.

### QuestionnaireAnswers
```typescript
Record<string, string | string[] | number>
// keys: question IDs (e.g. "app_name", "regions", "expected_users", "uptime", "monthly_budget")
// values: single string for single_select/free_text, string[] for multi_select, number for numeric fields
```

**Relationship to diagram:** Answers are passed to the Requirements Agent as context when the first chat message is sent. They are not displayed in the UI after canvas transition, but should be included in every agent call as context. This is not yet implemented — store the answers and thread them through.

---

## 2. Agent Data Flow

### Requirements → Architect

The Requirements Agent outputs:
```json
{
  "app_type": "Web app or SaaS",
  "services_needed": ["ALB", "ECS", "RDS", "S3"],
  "scale": "small",
  "constraints": ["low cost", "simple ops"]
}
```

This **blueprint** is the shared input for Architect, Coder, and Description agents. It is an intermediate representation — not shown to the user, not persisted.

**Invariant:** The `services_needed` array in the blueprint must correspond 1:1 with the nodes the Architect agent will stream. Downstream agents must only generate outputs for services that appear in the blueprint.

### Architect → Canvas (via WebSocket)

The Architect streams diagram events. Each event maps directly to a mutation of React Flow state:

| Event action | React Flow mutation |
|-------------|-------------------|
| `add_node` | Push to `nodes` array |
| `add_edge` | Push to `edges` array (after validating source/target exist) |
| `remove_node` | Filter `nodes` by id; also remove all edges referencing that id |
| `update_node` | Find node by id, merge data |

**Ordering invariant:** An `add_edge` event must only reference node IDs that have already been added via `add_node`. The Architect agent must stream nodes before edges. The frontend should not crash on out-of-order events but can silently drop edges whose nodes don't exist yet.

### Canvas → Terraform (via WebSocket)

When the user edits the canvas, the frontend sends the full current diagram state (nodes + edges) as context for regeneration. There is no surgical diff — the Coder agent regenerates everything from scratch.

Canvas state → WS payload: the `canvas_edit` message carries only the specific edit action (`add_node`, `remove_node`, etc.) and the changed entity. The backend reconstructs full state from conversation history. **This is a known MVP limitation** — in V1 the full canvas state should be sent on each edit.

Manual Terraform generation is requested explicitly via:

```json
{
  "type": "generate_terraform",
  "project_id": "project-123",
  "access_token": "jwt-token"
}
```

`generate_terraform` queues a coder-only rerun against the persisted current canvas nodes plus questionnaire requirements.

### Canvas → Chat (via WebSocket)

Chat requests are sent as:

```json
{
  "type": "chat",
  "message": "How is this selected path secured?",
  "project_id": "project-123",
  "selected_node_ids": ["alb", "ecs_service"]
}
```

`selected_node_ids` is optional:
- When present and non-empty, the backend appends a selected-node context block to the chat system prompt and the assistant should scope explanations to those nodes.
- When absent or empty, chat falls back to full architecture context (existing behavior).
- Invalid `selected_node_ids` values are ignored and treated as an empty selection.

When streaming chat responses, transient websocket failures can set frontend `pipelineStatus` to an `Error: ...` value. The client clears that transient error state when a subsequent successful `chat_reply` or `chat_reply_done` arrives so the generation status banner does not remain stuck after reconnect.

### Post-Generation → Thumbnail (via Background Task)

After the `done` event is sent to the client:
- Thumbnail generation (Pillow, 1200×630 PNG) spawned with 15s timeout
- PNG uploaded to Supabase Storage bucket `thumbnails/<project_id>.png`
- `projects.thumbnail_url` updated with public Supabase Storage URL (non-blocking on failure)
- Failure to generate/upload thumbnail does not block the completion of generation

This is a post-generation background step: the `done` event signals completion before thumbnail work begins, ensuring the client perceives fast completion. The thumbnail is later available for OpenGraph/social card previews on shareable project links.

---

## 3. Provider / API Key Model

### `user_llm_keys` table
Server-side BYOK keys are persisted in Supabase table `user_llm_keys`.

```sql
id uuid primary key default gen_random_uuid()
user_id uuid unique not null references auth.users(id) on delete cascade
provider text not null check (provider in ('anthropic', 'openrouter', 'openai'))
encrypted_key text not null
model text null
created_at timestamptz default now()
updated_at timestamptz default now()
```

### Key lifecycle
1. User saves key through `POST /api/llm-key`
2. Backend encrypts `api_key` using Fernet before persisting
3. `GET /api/llm-key` returns only `{ has_key, provider, model }` (never the key)
4. Generation/chat resolves per-user BYOK credentials server-side at request time
5. `DELETE /api/llm-key` removes the stored key row

**Invariant:** `encrypted_key` is always Fernet-encrypted using `LLM_KEY_ENCRYPTION_SECRET`. Plaintext keys are never stored or returned to the client.

### Provider model routing
```python
PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
    "openai": "gpt-4o"
}
```

**Constraint:** LLM calls prefer per-request BYOK credentials; env vars are fallback only.

### `projects` table

The projects table persists all diagram state and generation metadata in Supabase.

**Columns:**

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NO | Primary key, unique per project |
| `user_id` | UUID | NO | Foreign key to `auth.users(id)` |
| `title` | TEXT | NO | Project name derived from questionnaire answers |
| `project_mode` | TEXT | NO | UX mode for project interaction: `default` or `discovery` |
| `questionnaire_answers` | JSONB | YES | Normalized questionnaire answers for context |
| `nodes` | JSONB | YES | React Flow nodes array (current diagram state) |
| `edges` | JSONB | YES | React Flow edges array (current diagram state) |
| `terraform_files` | JSONB | YES | Object mapping filenames to Terraform HCL content |
| `cost_estimate` | JSONB | YES | Server-generated AWS monthly estimate payload (`region`, `monthly_total`, `items[]`, optional budget fields) |
| `description` | JSONB | YES | Architecture description with sections (overview, key_components, tradeoffs, next_steps) |
| `chat_history` | JSONB | YES | Array of chat messages (role, content) |
| `share_slug` | TEXT | YES | Unique 8-character slug for anonymous shareable links |
| `is_template` | BOOLEAN | NO | Marks a project as a reusable template source (`true`) or regular user project (`false`) |
| `generation_status` | TEXT | YES | Current generation state: idle, queued, running, complete, failed |
| `generation_stage` | TEXT | YES | Current pipeline stage: requirements, architect, cost_analyst, budget_retry, completed |
| `generation_error` | TEXT | YES | Error message if generation_status is failed |
| `generation_trace_id` | TEXT | YES | Unique trace ID for this generation run (correlates logs) |
| `generation_started_at` | TIMESTAMPTZ | YES | Timestamp when generation pipeline started |
| `generation_completed_at` | TIMESTAMPTZ | YES | Timestamp when generation pipeline completed (success or failure) |
| `thumbnail_url` | TEXT | YES | Public Supabase Storage URL for the OG preview thumbnail PNG (1200×630) |
| `setup_pdf_status` | TEXT | YES | Setup guide PDF state: none, generating, ready, failed, outdated |
| `setup_pdf_progress` | INTEGER | YES | Deterministic setup PDF progress percentage (0-100) |
| `setup_pdf_url` | TEXT | YES | Last generated signed setup PDF URL (short-lived) |
| `setup_pdf_storage_path` | TEXT | YES | Internal storage object path for setup PDF artifact |
| `setup_pdf_generated_at` | TIMESTAMPTZ | YES | Timestamp when setup PDF generation succeeded |
| `setup_pdf_source_revision` | TEXT | YES | Fingerprint of architecture outputs used for latest setup PDF |
| `setup_pdf_error` | TEXT | YES | Last setup PDF generation error (nullable) |
| `last_event_at` | TIMESTAMPTZ | YES | Timestamp of the last WebSocket event sent to client |
| `last_opened_at` | TIMESTAMPTZ | YES | Timestamp of most recent project open/navigation used for workspace auto-redirect |
| `created_at` | TIMESTAMPTZ | YES | Timestamp when project was created |
| `updated_at` | TIMESTAMPTZ | YES | Timestamp of last update |
| `terraform_generated_at` | TIMESTAMPTZ | YES | Timestamp when Coder agent last generated Terraform files |
| `architecture_modified_at` | TIMESTAMPTZ | YES | Timestamp when nodes/edges were last modified (mutation or canvas edit) |

**Constraints:**
- `share_slug` is unique across all projects (enforced at DB level)
- `user_id` enforces row-level security; users can only access their own projects
- `project_mode` is constrained to `default` or `discovery`
- Templates are represented as projects with `is_template = true` (usually with `user_id = NULL`) and are listed via `GET /api/templates`
- Cloning a template creates a new row with `is_template = false`, new `share_slug`, copied diagram/outputs, and empty `chat_history`
- Discovery projects use `project_mode = discovery`; generation start transitions to `project_mode = default`
- `nodes` and `edges` are always in sync (all edges reference node IDs that exist)
- `last_opened_at` is updated on project load and drives `/` routing to the most recently opened project
- `thumbnail_url` is generated asynchronously post-`done` event; may be NULL until thumbnail completes
- `setup_pdf_status` transitions: `none -> generating -> ready` (or `failed`); `ready` becomes `outdated` when architecture state changes
- `terraform_generated_at` is set when Coder agent completes successfully
- `architecture_modified_at` is set when nodes/edges are modified (mutation or canvas edit)
- `terraform_outdated` is computed by comparing `architecture_modified_at > terraform_generated_at`; indicates generated Terraform is stale

---

## 4. Questionnaire ↔ Canvas Relationship

The questionnaire answers and the canvas are connected through the agent pipeline, not directly. Here's the full data lineage:

```
QuestionnaireAnswers (localStorage / React state)
    ↓ (sent with first chat message)
Requirements Agent
    ↓
Blueprint JSON
    ↓
Architect
    ↓
Canvas nodes
    ↓
Cost Analyst (AWS Pricing API + server fallbacks)
    ↓
`cost_estimate` websocket message updates canvas overlay

Manual Terraform path:
Canvas state
    ↓
`generate_terraform` websocket message
    ↓
Coder agent returns Terraform files
```

**Important:** After the questionnaire completes and the canvas opens, the answers are still relevant context. They must be included in the Requirements Agent call. Currently `page.tsx` stores `questionnaireAnswers` in state but does not thread them through the WS message — this must be fixed in TICKET-002.

---

## 5. Node ID Collision Handling

Node IDs generated by the Architect agent can collide if:
1. The user generates a new architecture (second chat message) without clearing the canvas
2. Two architectures both produce a node with id `rds`

**Current behavior (MVP):** No collision handling — second architecture overwrites nodes with duplicate IDs in React Flow. This is acceptable for MVP but must be addressed before V1.

**Future fix:** Namespace node IDs per "generation" (e.g. `gen1_rds`, `gen2_rds`) or clear the canvas on each new architecture generation.

---

## 6. SSE Stream Format (Questionnaire)

The `/api/questionnaire` endpoint uses SSE, not WebSockets. The format:

```
data: {"id": "q4", "prompt": "...", "type": "single_select", "options": [...], "allow_custom": false}\n\n
data: {"id": "q5", ...}\n\n
data: {"done": true}\n\n
```

**Parsing rules:**
- Lines starting with `data: ` are message lines; strip the prefix and JSON-parse the value
- Empty lines are separators; ignore
- `{ "done": true }` signals stream completion — do not try to render it as a question
- Lines starting with `:` are SSE comments (keep-alive); ignore

**Invariant:** Question IDs must be sequential starting from `q4` (continuing from the 3 fixed questions q1-q3). The frontend uses these IDs as keys for the `answers` record — non-sequential IDs will break the answers map.

---

## 7. Terraform Output Structure

The Coder agent must return exactly this shape:
```json
{
  "files": {
    "main.tf": "...",
    "variables.tf": "...",
    "outputs.tf": "...",
    "versions.tf": "..."
  }
}
```

**Constraints:**
- `main.tf` is always required
- `variables.tf` must declare every variable referenced in `main.tf`
- No hardcoded values in `main.tf` — all configurable values must be variables
- File names are the keys; values are raw Terraform HCL strings
- The frontend renders each file as a separate tab in `OutputPanel`

---

## 8. Cost Estimation (Server-Side)

Cost estimation is computed server-side in `backend/agents/cost_analyst.py` and streamed via WebSocket as `cost_estimate`.

**WebSocket payload:**
```json
{
  "type": "cost_estimate",
  "project_id": "project-123",
  "region": "us-east-1",
  "monthly_total": 99.2,
  "items": [
    {
      "node_id": "rds",
      "label": "RDS PostgreSQL",
      "instance_type": "db.t3.medium",
      "cost": 29.2,
      "estimated": false
    },
    {
      "node_id": "lambda",
      "label": "Lambda",
      "cost": 5,
      "estimated": true
    }
  ],
  "budget_cap": 120,
  "monthly_budget": 120,
  "over_budget": false
}
```

**TypeScript types:**
```typescript
type NodeCost = {
  node_id: string;
  label: string;
  cost: number;
  instance_type?: string;
  estimated: boolean;
};

type CostBreakdown = {
  region: string;
  monthly_total: number;
  items: NodeCost[];
  budget_cap?: number;
  monthly_budget?: number;
  over_budget?: boolean;
};
```

**Pricing logic:**
1. If AWS credentials are missing, cost analysis is skipped.
2. If node has `aws_service_code` + `instance_type`, query AWS Pricing API and cache hourly price.
3. For usage-based services, use server-side monthly defaults and mark `estimated: true`.
4. If metadata is missing/invalid, use keyword fallback estimates and mark `estimated: true`.
5. If `regions` is empty, backend resolves closest region via geo-IP.

---

## 9. Architecture Description Structure

The Description Agent must return a single WS message:
```json
{
  "type": "arch_description",
  "sections": {
    "overview": "Prose paragraph (2-4 sentences) describing the overall architecture.",
    "key_components": "Prose paragraph naming and explaining the main AWS services used.",
    "tradeoffs": "Prose paragraph covering key design tradeoffs and why they were made.",
    "next_steps": "Prose paragraph suggesting concrete next steps to evolve this architecture."
  }
}
```

**TypeScript type:**
```typescript
type ArchDescription = {
  overview: string;
  key_components: string;
  tradeoffs: string;
  next_steps: string;
};
```

**Constraints:**
- Each section value is plain prose — no bullet points, no markdown headers, no newlines inside values
- Agent system prompt must enforce JSON-only output
- Rendered in `ArchDescriptionViewer.tsx` under the Description tab of `OutputPanel`
- Copy/Download actions produce a Markdown file with `## Section\nContent` format

---

## 10. Agent Log Messages

The backend emits `agent_log` messages in real-time as each agent makes progress. These power the `AgentActivityFeed` overlay on the canvas.

**WebSocket message shape (Server → Client):**
```json
{
  "type": "agent_log",
  "agent": "architect",
  "message": "Added ECS Fargate (compute)",
  "elapsed": 4.2,
  "duration_ms": 4200,
  "trace_id": "uuid",
  "details": {
    "nodes": 4,
    "edges": 3
  }
}
```

**Fields:**
- `agent`: one of `"requirements"` | `"architect"` | `"coder"` | `"description"`
- `message`: human-readable progress string (e.g. `"Generating Terraform..."`, `"Writing main.tf"`)
- `elapsed`: seconds since the pipeline `start_time` (rounded to 1 decimal)
- `duration_ms`: elapsed milliseconds since the pipeline `start_time`
- `trace_id`: generation correlation ID (nullable during discovery or standalone tests)
- `details`: optional agent-specific metadata object

**TypeScript type:**
```typescript
type AgentLogEntry = {
  id: number;           // client-generated: Date.now() + Math.random() for React key
  agent: "requirements" | "architect" | "coder" | "description";
  message: string;
  elapsed: number;
  duration_ms?: number;
  trace_id?: string | null;
  details?: Record<string, unknown>;
};
```

**Constraints:**
- Emitted by `backend/agents/log_helper.py::emit_log()`
- Frontend keeps at most 50 entries (oldest dropped via `.slice(-50)`)
- Displayed in `AgentActivityFeed.tsx` — absolute overlay, bottom-left of canvas
- Not persisted; cleared on each new generation

---

## 10.1 WebSocket Keepalive Ping

Server heartbeat pings keep idle websocket sessions alive between user actions.

**WebSocket message shape (Server -> Client):**
```json
{
  "type": "ping",
  "ts": 1712563200.123
}
```

**Fields:**
- `type`: literal `"ping"`
- `ts`: unix timestamp (seconds with fractional precision)

**Constraints:**
- Emitted by backend heartbeat task every 20 seconds.
- Frontend websocket client updates liveness timestamp from any received message, including `ping`.
- Frontend filters `ping` messages and does not forward them to app-level message handlers.

---

## 11. Pipeline Event Schema

The backend emits `pipeline_event` messages during generation/rerun orchestration.

```json
{
  "type": "pipeline_event",
  "stage": "coder",
  "event": "retrying",
  "level": "warning",
  "message": "coder retry 1/1 started",
  "details": {
    "state": "retrying(1)",
    "attempt": 2,
    "max_retries": 1
  },
  "trace_id": "uuid",
  "project_id": "uuid"
}
```

**Fields:**
- `stage`: pipeline stage, including `requirements`, `architect`, `coder`, `description`, `pipeline`, `rerun`, `budget_cap`
- `event`: stage lifecycle event (examples below)
- `level`: `"info"` | `"warning"` | `"error"`
- `message`: human-readable progress text
- `details`: optional event-specific payload

**Specialist lifecycle events (`coder`, `description`):**
- `started`
- `still_running` (heartbeat with elapsed time)
- `retrying`
- `attempt_failed`
- `completed`
- `failed_after_retries`

**Pipeline/Rerun terminal event details (`stage="pipeline"| "rerun"`, `event="completed"`):**
```json
{
  "total": 3,
  "completed": 2,
  "failed_after_retries": 1,
  "all_terminal": true,
  "specialists": {
    "coder": { "state": "completed", "attempts": 1, "retries_used": 0, "max_retries": 1, "last_error": null },
    "description": { "state": "completed", "attempts": 1, "retries_used": 0, "max_retries": 1, "last_error": null }
  }
}
```

**Terminal semantics:**
- `pipeline`/`rerun` emit `completed` when all selected specialists reach a terminal state (`completed` or `failed_after_retries`)
- A specialist terminal failure does not automatically fail the whole pipeline
- Full pipeline `failed` is reserved for pre-specialist critical failures (for example, architect failure) and other unrecoverable errors

## 12. Setup PDF Events + Endpoints

Setup PDF generation reuses the project websocket channel and emits deterministic milestones.

**WebSocket message (`Server -> Client`):**
```json
{
  "type": "setup_pdf_status",
  "project_id": "project-123",
  "setup_pdf_status": "generating",
  "setup_pdf_progress": 55,
  "setup_pdf_error": null
}
```

Milestones:
- 10: gather project artifacts
- 25: generic sections
- 55: project-specific sections
- 85: render PDF
- 100: persist artifact and mark ready

**HTTP endpoints:**
- `POST /api/projects/{project_id}/setup-pdf/generate` -> start generation
- `GET /api/projects/{project_id}/setup-pdf/download` -> signed download URL (auth required)

---

## 13. Diagram Event Schema v2

Extended `add_node` event:
```json
{
  "type": "diagram_event",
  "action": "add_node",
  "id": "ecs_cluster",
  "label": "ECS Cluster",
  "category": "compute",
  "node_type": "service",
  "parent_id": "vpc"
}
```

Fields:
- `node_type`: `"service"` (default) | `"container"`. Only VPC uses `"container"`.
- `parent_id`: optional. ID of the container node this service lives inside.

React Flow node shapes:

**Container (VPC):**
```typescript
{ id: "vpc", type: "container", position: {x:0,y:0},
  style: { width: 700, height: 500 },
  data: { label: "VPC", category: "network" } }
```

**Service inside VPC:**
```typescript
{ id: "ecs_cluster", type: "service", position: {x:0,y:0},
  parentId: "vpc", extent: "parent",
  data: { label: "ECS Cluster", category: "compute", nodeType: "ecs" } }
```

**Service outside VPC:**
```typescript
{ id: "cloudwatch", type: "service", position: {x:0,y:0},
  data: { label: "CloudWatch", category: "monitoring", nodeType: "cloudwatch" } }
```

TypeScript data types:
```typescript
type ServiceNodeData = { label: string; category: string; nodeType: string; }
type ContainerNodeData = { label: string; category: string; }
```

Invariants:
- VPC container must be emitted before any node with `parent_id: "vpc"`
- Layout (dagre) runs once on `"done"` event, not during streaming
- During streaming all positions are `{x:0, y:0}`; dagre assigns final positions on done
- `fitView` is triggered after dagre layout completes

---

## 14. Project Creation + Update + Snapshot Endpoints

### POST /api/projects

Creates a named project without starting generation.

**Headers:**
- `Authorization: Bearer <access_token>`

**Request JSON:**
```json
{ "name": "My App" }
```

**Response JSON:**
```json
{ "project_id": "uuid", "share_slug": "abc12345" }
```

### PATCH /api/projects/{project_id}

Updates mutable metadata for an owned project. Current supported field: `title`.

**Headers:**
- `Authorization: Bearer <access_token>`

**Request JSON:**
```json
{ "title": "Renamed Project" }
```

**Response JSON:**
```json
{ "ok": true }
```

### PATCH /api/projects/{project_id}/snapshot

Saves the current canvas state for an owned project.

**Headers:**
- `Authorization: Bearer <access_token>`

**Request JSON:**
```json
{ "nodes": [...], "edges": [...] }
```

**Response JSON:**
```json
{ "ok": true }
```

### Save Modal Behavior

- Clicking **Save** always opens the naming modal when the user can save (new project or existing owned project).
- For existing owned projects, the modal input is pre-filled with the current title.
- On modal submit for existing owned projects:
  - if title changed, frontend calls `PATCH /api/projects/{project_id}` first
  - then frontend calls `PATCH /api/projects/{project_id}/snapshot`
