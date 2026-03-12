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
- **Complex plans:** If a task requires multi-step planning or involves architectural decisions, write the plan to a markdown file in `/documents/` before starting. Persist ideas; don't keep them only in context.

---

## Core User Flow
1. User lands on app, enters their LLM API key in a Settings pane (stored client-side, never sent anywhere except the LLM provider)
2. User describes their app in the chat panel
3. Architect agent streams diagram events → React Flow canvas builds live
4. Coder + Cost Analyst agents run in parallel → Terraform files + cost estimate appear in output panel
5. User can drag, add, remove, rename nodes on the canvas
6. Any canvas edit triggers full Terraform regeneration
7. User downloads .tf files or copies shareable diagram link

---

## Stack
- **Frontend:** Next.js 14 (App Router), Tailwind CSS, React Flow
- **Backend:** FastAPI (Python), Claude SDK, WebSockets
- **Cost estimation:** Infracost API
- **Storage:** Supabase (anonymous shareable links, no auth in MVP)
- **Containerization:** Docker + docker-compose

---

## API Key Handling (MVP)

Users must provide their own LLM API key. The app supports three providers:

| Provider | Env var name used client-side | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Preferred, best tool use |
| OpenRouter | `OPENROUTER_API_KEY` | Cheapest option for users |
| OpenAI | `OPENAI_API_KEY` | GPT-4o fallback |

### Rules:
- API key is entered via a **Settings pane** in the left panel (Chat/Settings tabs) — no modal flow
- Key is stored client-side only (never persisted server-side)
- Key is sent per-request in the WebSocket message payload: `{ "api_key": "sk-...", "provider": "anthropic", "message": "..." }`
- Backend uses the key for that request only, never logs or stores it
- Settings pane allows updating the key/provider at any time
- If key is invalid, backend returns a clear error: `{ "error": "invalid_api_key", "provider": "anthropic" }`
- On the landing page, clearly state: *"Bring your own API key. We never store it."*

### Model routing:
```python
PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "anthropic/claude-3.5-sonnet",
    "openai": "gpt-4o"
}
```

---

## Agent Pipeline

```
User message
    ↓
[Requirements Agent]
  Input:  raw chat message + conversation history
  Output: structured JSON { app_type, services_needed, scale, constraints }
    ↓
[Architect Agent]                         ← streams diagram events via WebSocket
  Input:  requirements JSON
  Output: sequence of diagram events (see schema below)
    ↓
    ├────────────────────────────────┐
    ↓                                ↓
[Coder Agent]               [Cost Analyst Agent]   ← run in parallel
  Input:  architect blueprint    Input: blueprint
  Output: Terraform .tf files    Output: cost breakdown JSON
    ↓                                ↓
    └────────────────────────────────┘
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
- MVP has **no auth** — shareable links via Supabase anonymous storage only
- **Never deploy actual AWS infrastructure in MVP**
- API keys are never logged, stored, or sent anywhere except the LLM provider
- All agents use the same provider/key the user configured
- Keep agent system prompts strict: output must be valid JSON only, no prose

---

## WebSocket Message Types

```
Client → Server:
{ "type": "chat", "message": "...", "api_key": "sk-...", "provider": "anthropic" }
{ "type": "canvas_edit", "action": "remove_node", "id": "rds", "api_key": "...", "provider": "..." }
{ "type": "canvas_edit", "action": "add_node", "label": "Redis", "category": "database", "api_key": "...", "provider": "..." }

Server → Client:
{ "type": "diagram_event", "action": "add_node", ... }
{ "type": "terraform", "files": { "main.tf": "...", "variables.tf": "..." } }
{ "type": "cost_estimate", "monthly_total": 142.50, "breakdown": [...] }
{ "type": "chat_reply", "message": "I've added a Redis cache between your ECS service and RDS..." }
{ "type": "error", "error": "invalid_api_key", "provider": "anthropic" }
{ "type": "done" }
```

---

## Project Structure

```
drawtocloud/
├── frontend/
│   ├── app/
│   │   ├── page.tsx               # main app layout
│   │   └── layout.tsx
│   ├── components/
│   │   ├── Chat.tsx                # chat panel
│   │   ├── Canvas.tsx              # React Flow diagram
│   │   ├── OutputPanel.tsx         # Terraform + cost tabs
│   ├── lib/
│   │   ├── websocket.ts
│   │   └── storage.ts              # localStorage helpers
│   └── package.json
├── backend/
│   ├── agents/
│   │   ├── requirements.py
│   │   ├── architect.py            # streams diagram events
│   │   ├── coder.py
│   │   └── cost_analyst.py
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

### In scope:
- [ ] Settings pane for AI provider + API key (BYOK)
- [ ] Chat interface
- [ ] Live React Flow diagram building via streamed events
- [ ] Manual canvas editing (add / remove / rename nodes)
- [ ] Terraform export (downloadable .tf files)
- [ ] Cost estimate panel
- [ ] Shareable diagram link (Supabase anonymous)
- [ ] Landing page with clear "bring your own key" messaging

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

## MVP Definition (what is and is NOT in scope)

### In scope:
- [ ] Settings pane for AI provider + API key (BYOK)
- [ ] Chat interface
- [ ] Live React Flow diagram building via streamed events
- [ ] Manual canvas editing (add / remove / rename nodes)
- [ ] Terraform export (downloadable .tf files)
- [ ] Cost estimate panel
- [ ] Shareable diagram link (Supabase anonymous)
- [ ] Landing page with clear "bring your own key" messaging

### Out of scope (V2+):
- AWS account connection + deploy button
- Validator agent (tfsec + terraform validate)
- Auth / user accounts
- Team collaboration
- Drift detection
- Managed infrastructure / commission model
