# DrawToCloud — Platform Documentation

Complete feature reference, generated from the codebase. Keep this in sync as features ship.

---

## 1. Entry Experience

### Smart Onboarding Questionnaire
**Route:** `/` (initial app state before canvas)

The app opens directly into a guided questionnaire — no sign-up required. The questionnaire runs in two phases:

**Phase 1 — Fixed questions (always asked, one at a time):**
| # | Question | Type | Options |
|---|----------|------|---------|
| q1 | What are you building? | single_select (allow_custom) | Web app or SaaS, Mobile backend / API, AI / ML workload, Data pipeline or ETL, E-commerce platform, Internal tooling, Other |
| q2 | What stage is this? | single_select | Prototype, MVP, Growth, Production |
| q3 | What's your team size? | single_select | Solo founder, 2–5 people, 6–20 people, 20+ people |

**Phase 2 — AI-personalized follow-up questions:**
- After q3 is answered, the frontend POSTs to `POST /api/questionnaire` with the three answers
- The backend calls the Questionnaire Agent (LLM), which generates 3–7 contextual follow-up questions
- Questions arrive via Server-Sent Events (SSE) and are shown one at a time as they stream
- Topics: traffic scale, data storage needs, availability, existing AWS services, deployment regions, team AWS experience

**UX Details:**
- Questions fade in/out with a 300ms transition (`opacity` + `translateY`)
- Keyboard shortcuts: number keys 1–N select options; Enter submits; Backspace in text fields reverts
- A dot-based progress bar shows answered / current / remaining questions
- While personalized questions load, the progress bar shows animated pulsing dots
- "Other" options reveal a free-text input inline (no separate screen)
- Multi-select questions allow any combination; single-select auto-advances on tap

**Completion:**
- After all questions are answered a `GenerateButton` appears with a human-readable summary (e.g. "Web app · MVP · Solo")
- Tapping it calls `onComplete(answers)` on the parent → transitions to the Canvas screen

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
| `chat` | `{ message, api_key, provider }` | User sends a natural-language description |
| `canvas_edit` | `{ action: "add_node"\|"remove_node", id?, label?, category?, api_key, provider }` | User edits the canvas manually |

**Server → Client messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `diagram_event` | `{ action: "add_node"\|"add_edge", id, label, category }` / `{ from, to, label }` | Live canvas update; consumed incrementally |
| `chat_reply` | `{ message }` | Assistant's conversational response |
| `terraform` | `{ files: { "main.tf": "...", ... } }` | Generated Terraform files |
| `cost_estimate` | `{ monthly_total: float, breakdown: [...] }` | Cost breakdown per service |
| `error` | `{ error: "invalid_api_key"\|"invalid_json"\|..., provider? }` | Error event |
| `done` | — | Signals end of event stream |

**Connection behavior:**
- Singleton WS client (`lib/websocket.ts`) auto-reconnects after 2s on close
- Multiple `onMessage` subscribers supported; each returns an unsubscribe function

---

## 4. API Key Flow

**API:** Users bring their own LLM key — DrawToCloud never stores it server-side.

**Supported providers:**

| Provider | Key format | Default model |
|----------|-----------|---------------|
| Anthropic | `sk-ant-...` | `claude-sonnet-4-20250514` |
| OpenRouter | `sk-or-...` | `anthropic/claude-3.5-sonnet` |
| OpenAI | `sk-...` | `gpt-4o` |

**Flow:**
1. User enters provider + API key via a **Settings pane** in the left panel (Chat/Settings tabs)
2. Key + provider are stored in `localStorage` under keys `dtc_api_key` / `dtc_provider`
3. Every WS message includes `{ api_key, provider }` in the payload
4. Backend uses the key for that request only — never logged or persisted
5. Invalid key → backend emits `{ type: "error", error: "invalid_api_key", provider }`
6. Settings pane allows updating the key/provider at any time

**Storage helpers** (`lib/storage.ts`): `getApiKey()`, `setApiKey()`, `getProvider()`, `setProvider()`, `clearCredentials()`

---

## 5. Agent Pipeline

```
User chat message
      ↓
[Requirements Agent]        → { app_type, services_needed, scale, constraints }
      ↓
[Architect Agent]           → streams diagram_event messages via WebSocket (live canvas build)
      ↓          ↓
[Coder Agent]   [Cost Analyst Agent]    ← parallel
      ↓               ↓
{ files: {...} }   { monthly_total, breakdown }
      ↓
Final output → terraform + cost_estimate WS messages
```

**Streaming rule:** Architect agent MUST emit events one at a time, never batch. Frontend consumes and applies each event to React Flow state immediately.

**Agent output contracts:**

| Agent | Input | Output |
|-------|-------|--------|
| Requirements | raw message + history | `{ app_type, services_needed, scale, constraints }` |
| Architect | requirements JSON | stream of `diagram_event` JSON objects |
| Coder | blueprint | `{ files: { "main.tf": "...", "variables.tf": "..." } }` |
| Cost Analyst | blueprint | `{ monthly_total: float, breakdown: [...] }` |
| Questionnaire | `{ app_type, stage, team_size }` | stream of Question objects |

---

## 6. Questionnaire Agent (implemented)

**File:** `backend/agents/questionnaire.py`
**Endpoint:** `POST /api/questionnaire`
**Transport:** Server-Sent Events (`text/event-stream`)

- Accepts `{ "answers": { app_type, stage, team_size } }`
- Calls LLM with strict JSON-only system prompt
- Streams back questions one at a time (`data: {...}\n\n`), 100ms apart
- Final event: `data: {"done": true}\n\n`

**Question schema:**
```json
{
  "id": "q4",
  "prompt": "What's your expected daily traffic?",
  "type": "single_select | multi_select | free_text",
  "options": ["< 1k/day", "1k-100k/day", "100k+/day"] | null,
  "allow_custom": false
}
```

---

## 7. Output Panel

**Component:** `components/OutputPanel.tsx` — *stub, ships in TICKET-003*

**Planned tabs:**
- **Terraform** — displays generated `.tf` files with syntax highlighting; download button for `.zip`
- **Cost estimate** — monthly total + per-service breakdown from Cost Analyst agent

---

## 8. Shareable Links

**Status:** Planned (TICKET-004)
**Implementation:** Supabase anonymous storage — no auth required
- Canvas state serialized and stored as anonymous document
- Short URL generated and copied to clipboard
- No user account needed; links are ephemeral

---

## 9. HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{ "status": "ok" }` |
| POST | `/api/questionnaire` | SSE stream of personalized questions |
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
| `ANTHROPIC_API_KEY` | Backend | Fallback key for server-side dev |
| `OPENAI_API_KEY` | Backend | Fallback key for server-side dev |
| `OPENROUTER_API_KEY` | Backend | Fallback key for server-side dev |
