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
}
```

**Relationship to diagram:** Chat messages are NOT stored server-side in MVP. The canvas state and chat history are independent — a chat reply can reference nodes by label, but there is no formal link between a `ChatMessage` and the `Node` objects it describes.

### QuestionnaireAnswers
```typescript
Record<string, string | string[]>
// keys: question IDs ("app_name", "app_type", "stage", "team_size", "q4", "q5", ...)
// values: single string for single_select/free_text, string[] for multi_select
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

This **blueprint** is the shared input for Architect, Coder, and Cost Analyst. It is an intermediate representation — not shown to the user, not persisted.

**Invariant:** The `services_needed` array in the blueprint must correspond 1:1 with the nodes the Architect agent will stream. The Coder and Cost Analyst agents must only generate Terraform/cost for services that appear in the blueprint.

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
| `questionnaire_answers` | JSONB | YES | Normalized questionnaire answers for context |
| `nodes` | JSONB | YES | React Flow nodes array (current diagram state) |
| `edges` | JSONB | YES | React Flow edges array (current diagram state) |
| `terraform_files` | JSONB | YES | Object mapping filenames to Terraform HCL content |
| `cost_estimate` | JSONB | YES | Cost breakdown with monthly_total and breakdown array |
| `description` | JSONB | YES | Architecture description with sections (overview, key_components, tradeoffs, next_steps) |
| `chat_history` | JSONB | YES | Array of chat messages (role, content) |
| `share_slug` | TEXT | YES | Unique 8-character slug for anonymous shareable links |
| `generation_status` | TEXT | YES | Current generation state: idle, queued, running, complete, failed |
| `generation_stage` | TEXT | YES | Current pipeline stage: requirements, architect, parallel_agents, done |
| `generation_error` | TEXT | YES | Error message if generation_status is failed |
| `generation_trace_id` | TEXT | YES | Unique trace ID for this generation run (correlates logs) |
| `generation_started_at` | TIMESTAMPTZ | YES | Timestamp when generation pipeline started |
| `generation_completed_at` | TIMESTAMPTZ | YES | Timestamp when generation pipeline completed (success or failure) |
| `thumbnail_url` | TEXT | YES | Public Supabase Storage URL for the OG preview thumbnail PNG (1200×630) |
| `last_event_at` | TIMESTAMPTZ | YES | Timestamp of the last WebSocket event sent to client |
| `created_at` | TIMESTAMPTZ | YES | Timestamp when project was created |
| `updated_at` | TIMESTAMPTZ | YES | Timestamp of last update |

**Constraints:**
- `share_slug` is unique across all projects (enforced at DB level)
- `user_id` enforces row-level security; users can only access their own projects
- `nodes` and `edges` are always in sync (all edges reference node IDs that exist)
- `thumbnail_url` is generated asynchronously post-`done` event; may be NULL until thumbnail completes

---

## 4. Questionnaire ↔ Canvas Relationship

The questionnaire answers and the canvas are connected through the agent pipeline, not directly. Here's the full data lineage:

```
QuestionnaireAnswers (localStorage / React state)
    ↓ (sent with first chat message)
Requirements Agent
    ↓
Blueprint JSON
    ↓           ↓           ↓
Architect    Coder    Cost Analyst
    ↓           ↓           ↓
Canvas     Terraform    Cost estimate
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

## 8. Cost Estimate Structure

The Cost Analyst agent must return:
```json
{
  "monthly_total": 142.50,
  "breakdown": [
    { "service": "ECS Fargate", "monthly": 45.00, "assumptions": "2 vCPU, 4GB, 720h/mo" },
    { "service": "RDS PostgreSQL", "monthly": 67.50, "assumptions": "db.t3.medium, Multi-AZ, 100GB" },
    { "service": "ALB", "monthly": 22.00, "assumptions": "10 LCU average" },
    { "service": "S3", "monthly": 8.00, "assumptions": "100GB storage, 1M requests/mo" }
  ]
}
```

**Constraints:**
- `monthly_total` must equal the sum of `breakdown[].monthly` (within floating point tolerance)
- Every node in the diagram that has a cost must appear in `breakdown`
- Free services (VPC, security groups, IAM) should be noted but may be omitted from breakdown
- `assumptions` string is shown in the UI — must be human-readable

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
  "elapsed": 4.2
}
```

**Fields:**
- `agent`: one of `"requirements"` | `"architect"` | `"coder"` | `"cost_analyst"` | `"description"`
- `message`: human-readable progress string (e.g. `"Generating Terraform..."`, `"Writing main.tf"`)
- `elapsed`: seconds since the pipeline `start_time` (rounded to 1 decimal)

**TypeScript type:**
```typescript
type AgentLogEntry = {
  id: number;           // client-generated: Date.now() + Math.random() for React key
  agent: "requirements" | "architect" | "coder" | "cost_analyst" | "description";
  message: string;
  elapsed: number;
};
```

**Constraints:**
- Emitted by `backend/agents/log_helper.py::emit_log()`
- Frontend keeps at most 50 entries (oldest dropped via `.slice(-50)`)
- Displayed in `AgentActivityFeed.tsx` — absolute overlay, bottom-left of canvas
- Not persisted; cleared on each new generation

---

## 11. Diagram Event Schema v2

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
