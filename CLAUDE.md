# DrawToCloud

Conversational AWS infrastructure designer with a live React Flow canvas.
User chats → multi-agent pipeline → diagram builds in real time → Terraform export + cost estimate.

## Required Reading

Before writing any code, read the relevant documents. These are not optional — code must be compliant with them.

### Sub-instructions (workspace-specific)
- **Frontend:** [`frontend/CLAUDE.md`](frontend/CLAUDE.md) — Next.js, React Flow, component rules, API key flow
- **Backend:** [`backend/CLAUDE.md`](backend/CLAUDE.md) — FastAPI, agents, WebSocket protocol, model routing

### Product documents (`/documents/`)
- [`documents/platform-docs.md`](documents/platform-docs.md) — Every feature, endpoint, agent, and data shape. Reference before implementing anything.
- [`documents/ICPs.md`](documents/ICPs.md) — Two ideal customer profiles (solo founders, DevOps engineers). Features must serve at least one of them.
- [`documents/styleguide.md`](documents/styleguide.md) — Color palette, typography, spacing, component patterns, motion. All UI code must follow this.
- [`documents/vision.md`](documents/vision.md) — North star ("Figma for cloud infra") and roadmap. Use this to decide if a feature belongs in MVP or later.
- [`documents/data-reference.md`](documents/data-reference.md) — Domain data invariants, agent data flow, entity relationships. Read before touching any data flow or agent logic.

### Compliance rules
- **UI:** Every new component must use colors, spacing, and patterns from `styleguide.md`. Do not introduce new color values without updating the style guide.
- **Data:** Every new data shape (agent input/output, WS message, API payload) must be documented in `data-reference.md`.
- **Features:** Every new feature must serve an ICP from `ICPs.md`. If it serves neither, it belongs in a future version — note it in `vision.md`.
- **Documents:** When implementing a feature that changes an existing contract (agent output, WS message type, API shape), update the relevant document immediately — do not let docs drift from code.
- **Complex plans:** If a task requires multi-step planning or involves architectural decisions, write the plan to a markdown file in `documents/plans/` before starting. Persist ideas; don't keep them only in context.

---

## Core User Flow
1. User lands on app and signs in via Supabase Auth (email/password or OAuth)
2. User fills the pre-generation form (`/new`) — either provides a description (fast path → immediate generation) or skips description to enter a chat-first discovery interview
3. Architect agent streams diagram events → React Flow canvas builds live
4. Coder + Cost Analyst + Description agents run in parallel → Terraform files, cost estimate, and architecture description appear in output panel
5. User can drag, add, remove, rename nodes on the canvas
6. Any canvas edit triggers full Terraform regeneration
7. User downloads .tf files or copies shareable diagram link

---

## Stack
- **Frontend:** Next.js 14 (App Router), Tailwind CSS, React Flow
- **Backend:** FastAPI (Python), Claude SDK, WebSockets
- **Cost estimation:** Infracost API
- **Storage:** Supabase (auth, project storage, shareable links)
- **Containerization:** Docker + docker-compose

---

## LLM Key Handling

LLM API keys are managed server-side via environment variables. The backend selects the active key at startup from the following env vars (first found wins):

| Provider | Env var | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Preferred, best tool use |
| OpenAI | `OPENAI_API_KEY` | GPT-4o fallback |
| OpenRouter | `OPENROUTER_API_KEY` | Last resort |

### Rules:
- Keys are loaded from the server environment — never from the client
- WS messages no longer carry `api_key` / `provider` fields; auth is via Supabase `access_token`
- Keys are never logged or exposed to clients

### Model routing:
```python
PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai": "gpt-4o",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
}
```

---

## Agent Pipeline

```
Pre-gen form answers (fast path) or conversation summary (chat-first path)
    ↓
[Requirements Agent]
  Input:  answers dict — description or conversation_summary + region/users/uptime/compliance/environment/compute_preference
  Output: structured JSON { app_name, inferred_services, architecture_style, notes }
    ↓
[Architect Agent]                         ← streams diagram events via WebSocket (sequential)
  Input:  requirements JSON
  Output: sequence of diagram events (see schema below)
    ↓
    ├────────────────────────┬──────────────────────────┐
    ↓                        ↓                          ↓
[Coder Agent]     [Cost Analyst Agent]     [Description Agent]   ← run in parallel
  Output:            Output:                  Output:
  Terraform .tf      cost breakdown JSON      arch_description JSON
    ↓                        ↓                          ↓
    └────────────────────────┴──────────────────────────┘
                             ↓
               Final output assembled → sent to frontend
```

---

## Diagram Events Schema

The Architect agent MUST stream events one at a time, not return all at once.
Frontend consumes these via WebSocket and mutates React Flow state incrementally.

```json
{ "type": "diagram_event", "action": "add_node", "id": "vpc", "label": "VPC", "category": "network" }
{ "type": "diagram_event", "action": "add_node", "id": "alb", "label": "Load Balancer", "category": "compute" }
{ "type": "diagram_event", "action": "add_edge", "from": "alb", "to": "ecs", "label": "routes to" }
{ "type": "diagram_event", "action": "add_node", "id": "rds", "label": "RDS PostgreSQL", "category": "database" }
{ "type": "diagram_event", "action": "add_node", "id": "s3", "label": "S3 Bucket", "category": "storage" }
{ "type": "diagram_event", "action": "add_edge", "from": "ecs", "to": "rds", "label": "reads/writes" }
```

Node categories and their colors on canvas:
- `network` → blue (VPC, subnets, route tables)
- `compute` → orange (EC2, ECS, Lambda, ALB)
- `database` → green (RDS, DynamoDB, ElastiCache)
- `storage` → yellow (S3, EFS)
- `security` → red (IAM, Security Groups, WAF)
- `monitoring` → purple (CloudWatch, SNS)

---

## Component Rules (Frontend)

- **Never create a component longer than 150 lines.** If it exceeds this, split it into smaller components automatically.
- **Always separate UI from logic.** Keep rendering in the component file; move state, effects, and handlers into a co-located `use<Name>.ts` hook.

---

## Key Constraints

- Architect agent MUST stream events, never return a batch
- Node edits on canvas (add/remove/rename) trigger **full Terraform regeneration** — no surgical diff in MVP
- Auth is required: all WS messages and API calls must include a valid Supabase `access_token`
- **Never deploy actual AWS infrastructure in MVP**
- LLM keys are server-side env vars — never logged, stored client-side, or sent to the client
- All agents use the server-configured LLM key
- Keep agent system prompts strict: output must be valid JSON only, no prose

---

## WebSocket Message Types

```
Client → Server:
{ "type": "start_generation", "answers": {...}, "access_token": "...", "project_id"?: "..." }
{ "type": "chat_discovery_start", "app_name": "...", "region": "...", "expected_users": "...", "uptime": "...", "compliance"?: "...", "environment"?: "...", "compute_preference"?: "...", "access_token": "..." }
{ "type": "chat", "message": "...", "access_token": "...", "project_id": "..." }
{ "type": "canvas_edit", "action": "remove_node", "id": "rds", "access_token": "...", "project_id": "..." }
{ "type": "canvas_edit", "action": "add_node", "label": "Redis", "category": "database", "access_token": "...", "project_id": "..." }
{ "type": "subscribe_project", "project_id": "...", "access_token": "..." }

Server → Client:
{ "type": "project_ready", "project_id": "...", "share_slug": "..." }
{ "type": "diagram_event", "action": "add_node", ... }
{ "type": "terraform_file", "filename": "main.tf", "content": "...", "project_id": "...", "trace_id": "..." }
{ "type": "cost_estimate", "monthly_total": 142.50, "breakdown": [...] }
{ "type": "arch_description", "sections": {...}, "project_id": "...", "trace_id": "..." }
{ "type": "chat_reply", "message": "...", "project_id": "...", "plan_ready": false }
{ "type": "chat_reply_delta", "delta": "...", "project_id": "..." }
{ "type": "chat_reply_done", "message": "...", "project_id": "...", "plan_ready": true }
{ "type": "error", "error": "unauthenticated"|"invalid_json"|..., "message": "..." }
{ "type": "done", "project_id": "...", "trace_id": "..." }
```

---

## Project Structure

```
drawtocloud/
├── frontend/
│   ├── app/
│   │   ├── new/page.tsx           # new generation page
│   │   └── layout.tsx
│   ├── components/
│   │   ├── PreGenForm/             # single-screen pre-gen form
│   │   │   ├── index.tsx
│   │   │   ├── usePreGenForm.ts
│   │   │   ├── OperationalSelectors.tsx
│   │   │   ├── AdvancedOptions.tsx
│   │   │   └── AiPromptHelper.tsx
│   │   ├── Chat.tsx                # chat panel
│   │   ├── Canvas.tsx              # React Flow diagram
│   │   ├── OutputPanel.tsx         # Terraform + cost tabs
│   ├── lib/
│   │   ├── websocket.ts
│   │   ├── projects.ts             # CanvasSession type
│   │   ├── useCanvasPipeline.ts    # pipeline state + WS handling
│   │   └── storage.ts              # localStorage helpers
│   └── package.json
├── backend/
│   ├── agents/
│   │   ├── requirements.py
│   │   ├── architect.py            # streams diagram events
│   │   ├── coder.py
│   │   ├── cost_analyst.py
│   │   └── discovery_agent.py      # chat-first discovery interview
│   ├── main.py                     # FastAPI app
│   ├── ws_handler.py               # WebSocket orchestration
│   ├── llm_client.py               # unified Anthropic/OpenRouter/OpenAI client
│   └── requirements.txt
├── docker-compose.yml
├── CLAUDE.md                       # this file
└── README.md
```

---

## MVP Definition (what is and is NOT in scope)

### In scope (shipped):
- [x] Supabase Auth (email/password + OAuth)
- [x] Pre-generation form with fast path and chat-first discovery path
- [x] Chat interface
- [x] Live React Flow diagram building via streamed events
- [x] Full agent pipeline: Requirements → Architect → (Coder + Cost Analyst + Description) in parallel
- [x] Manual canvas editing (add / remove / rename nodes) — triggers full Terraform regeneration
- [x] Terraform export (downloadable .tf files)
- [x] Cost estimate panel
- [x] Generation history dashboard
- [x] Quota system (per-user generation limits, admin entitlements)
- [ ] Shareable diagram link (Supabase anonymous)

---

## Development Workflow

### Bug Reporting Workflow
When a bug is reported:
1. Write a failing test that reproduces the bug BEFORE attempting any fix
2. Confirm the test fails as expected
3. Use subagents to try different fixes
4. A fix is only accepted when the test passes

### FastAPI Documentation Rule
Every API endpoint (HTTP routes and WebSocket) must be documented using FastAPI's built-in tooling:
- HTTP routes: use `summary`, `description`, `response_model`, and `responses` parameters on the decorator
- WebSocket: add a docstring describing accepted message types and emitted events
- Tag endpoints by domain (e.g., `tags=["health"]`, `tags=["websocket"]`)

---

### Out of scope (V2+):
- AWS account connection + deploy button
- Validator agent (tfsec + terraform validate)
- Team collaboration
- Drift detection
- Managed infrastructure / commission model
