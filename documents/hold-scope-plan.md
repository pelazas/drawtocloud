# DrawToCloud — HOLD SCOPE Implementation Plan

> Generated: 2026-03-14
> Mode: HOLD SCOPE — fix foundation before features
> Source: CEO Plan Review session

---

## Context: What the Code Actually Is Today

The docs describe a BYOK, no-auth app. The code is something different:

| What docs say | What code does |
|---|---|
| No auth (MVP) | Full Supabase OAuth |
| BYOK: user sends `api_key` per WS message | Server-side LLM keys from env vars |
| MVP in progress (TICKET-001 to TICKET-004) | Full pipeline + quota + admin + chat + history dashboard |
| Agent pipeline: Requirements → Architect → (Coder + Cost) parallel | All 4 agents run in parallel from `requirements` directly |
| canvas_edit triggers Terraform regeneration | canvas_edit is a stub — sends `done`, does nothing |

This divergence is the #1 onboarding hazard. **Docs must be synced as part of this plan.**

---

## Critical Bugs Found

### BUG-1: Quota increment race condition (`quota.py:28-36`)
**Severity: HIGH**
Read-then-write without atomic operation. Two concurrent generations completing simultaneously both read `generations_used=4`, both write `5`. A user submitting from two tabs gets two generations for the price of one.

```python
# CURRENT (broken)
quota = get_user_quota(user_id)          # READ
next_value = quota["generations_used"] + 1
supabase.table("profiles").update(...)   # WRITE
```

Fix: Supabase RPC with atomic `UPDATE ... SET generations_used = generations_used + 1 WHERE id = $1 AND generations_used < generations_limit RETURNING *`

---

### BUG-2: Synchronous Supabase calls block the async event loop
**Severity: HIGH**
All `update_project_fields`, `get_project_for_user`, `get_user_quota` calls are synchronous (supabase-py). Called from async FastAPI context without `asyncio.to_thread`. During generation, ~18 blocking writes occur (one per diagram node/edge). Each blocks for ~100-300ms.

Fix: Wrap all Supabase calls in `asyncio.to_thread()`.

---

### BUG-3: CORS hardcoded to `http://localhost:3000` (`main.py:22`)
**Severity: HIGH**
Every production deployment breaks CORS unless someone manually edits the code.

Fix: `ALLOWED_ORIGINS` env var, comma-separated, defaults to `http://localhost:3000`.

---

### BUG-4: `canvas_edit` is an empty stub (`ws_handler.py:359-361`)
**Severity: HIGH**
The WS message type `canvas_edit` sends `done` immediately with no regeneration. The spec says any canvas edit triggers full Terraform regeneration.

Fix: Implement proper canvas edit → update project nodes/edges → trigger `start_generation_for_user`.

---

### BUG-5: All 4 agents run in parallel instead of sequenced (`generation_service.py:467-472`)
**Severity: HIGH**
`asyncio.gather(architect, coder, cost_analyst, description)` runs all 4 from `requirements` simultaneously. The coder and cost_analyst never see the architect's diagram output — they're independently interpreting the same requirements. This means Terraform may not match the canvas.

Fix: Run architect to completion first, capture its node list, then run coder + cost_analyst + description in parallel with both `requirements` AND architect output as context.

---

### BUG-6: `asyncio.gather` doesn't cancel sibling agents on failure (`generation_service.py:467`)
**Severity: MEDIUM**
When one agent raises, `asyncio.gather` raises immediately but does NOT cancel the other 3 tasks. They continue running and writing state to a project already marked `failed`. Partial/corrupt data can be written after error state is set.

Fix: Replace `asyncio.gather` with `asyncio.TaskGroup` (Python 3.11+). Cancels remaining tasks on first failure.

---

### BUG-7: Architect silently drops JSON parse failures (`architect.py:54-55`)
**Severity: MEDIUM**
```python
except json.JSONDecodeError:
    pass  # silently skip prose/preamble lines
```
If the LLM hallucinates non-JSON mid-stream, events are silently dropped. Generation "succeeds" but produces an empty or partial diagram with no user-visible error.

Fix: Count consecutive bad lines. Emit `pipeline_event` warning on each drop. Raise after 3 consecutive non-JSON lines (after first valid node was emitted).

---

### BUG-8: `infracost` subprocess blocks the event loop (`cost_analyst.py:55`)
**Severity: MEDIUM**
`subprocess.run(..., timeout=120)` is synchronous. During the up-to-120s infracost run, the event loop is completely blocked — no WS events, no other requests.

Fix: Wrap in `asyncio.to_thread(subprocess.run, ...)`.

---

### BUG-9: Auth network errors map to `invalid_token` (`auth.py:39-42`)
**Severity: LOW**
`except Exception: return None` swallows all errors including Supabase network failures. A user with a valid session gets "Session expired" during a Supabase outage.

Fix: Distinguish between `AuthApiError` (expired/invalid token → return None) and network/unexpected errors (log and re-raise or return a distinct sentinel).

---

### BUG-10: Cost analyst AI fallback silently produces no result (`cost_analyst.py:127-134`)
**Severity: LOW**
When the AI cost fallback fails to parse, `except (json.JSONDecodeError, Exception)` emits a `pipeline_event` but continues. The `cost_estimate` message is never sent. Users see no cost tab with no explanation.

Fix: Emit a `cost_estimate` with a clearly marked "estimation failed" placeholder, or surface a user-visible error in the cost tab.

---

## Architecture Issues

### ARCH-1: Single-worker constraint (in-memory broadcaster)
`_BROADCASTER`, `_RUNNING_TASKS`, `_RUNTIMES` are module-level globals. Multi-worker deployment breaks WS delivery.

**Decision:** Document constraint explicitly. Add startup guard (`WEB_CONCURRENCY=1` enforced, runtime assertion). Fix in V1 with Redis pub/sub.

### ARCH-2: No DB migration tracking
Supabase schema is managed via dashboard with no migration files. No rollback story for schema changes.

**Decision:** Track as known operational debt. Add to onboarding docs.

---

## Quality Issues

### QUALITY-1: `GenerationRuntime.send_text` is 111 lines with 8+ branches
Each `if msg_type == "..."` block handles routing, DB writes, and broadcasting. Should be a type-dispatch table where each msg_type maps to a private handler method.

### QUALITY-2: `useCanvasPipeline.ts` is 885 lines
Violates the 150-line component rule. The `onMessage` handler processes 15 message types inline. Should dispatch to type-specific handlers.

### QUALITY-3: DRY violations in frontend
- `asNonNegativeInt` defined identically in `app/page.tsx:13-19` and `app/new/page.tsx:23-29`
- `refreshQuota` Supabase logic duplicated in both files

Fix: Extract to `lib/utils.ts` and `lib/useQuota.ts`.

---

## Observability Gaps

- Backend logs don't include `trace_id` or `project_id` — backend logs and frontend debug reports can't be correlated
- `/health` endpoint doesn't probe DB connectivity — a broken Supabase connection is invisible to load balancers
- Agent parse failures in `architect.py` are completely silent (no log statement)

---

## Error & Rescue Map (Critical Gaps)

| Codepath | Failure Mode | Current Status | Fix |
|---|---|---|---|
| `architect.py` JSON parse | Bad LLM lines silently dropped | **CRITICAL GAP** | Count + raise after 3 |
| Cost analyst AI fallback | Parse fails, no cost_estimate sent | **GAP** | Emit error placeholder |
| `auth.verify_access_token` | Network error → "session expired" | **GAP** | Distinguish error types |
| Quota increment | Race condition → wrong count | **CRITICAL GAP** | Atomic DB operation |
| `asyncio.gather` partial | Siblings run after failure | **GAP** | Use TaskGroup |

---

## Implementation Order

### P0 — Fix bugs (each starts with a failing test per CLAUDE.md)

| # | Fix | File(s) | Test file |
|---|---|---|---|
| 1 | Atomic quota increment | `backend/quota.py` | `backend/tests/test_quota.py` (new) |
| 2 | asyncio.TaskGroup for agents | `backend/generation_service.py` | `backend/tests/test_generation_service.py` |
| 3 | Architect parse failure counting | `backend/agents/architect.py` | `backend/tests/agents/test_architect.py` (new) |
| 4 | asyncio.to_thread for all Supabase calls | `backend/project_store.py`, `backend/quota.py`, `backend/auth.py` | existing test suite |
| 5 | infracost async | `backend/agents/cost_analyst.py` | `backend/tests/agents/test_cost_analyst.py` (new) |
| 6 | CORS env var | `backend/main.py` | `backend/tests/test_health.py` |

### P1 — Architecture fixes

| # | Fix | File(s) |
|---|---|---|
| 7 | Agent sequencing (architect first, pass node list to coder/cost/description) | `backend/generation_service.py`, `backend/agents/architect.py`, `backend/agents/coder.py`, `backend/agents/cost_analyst.py`, `backend/agents/description.py` |
| 8 | Canvas edit → Terraform regeneration | `backend/ws_handler.py`, `backend/generation_service.py` |
| 9 | Type-dispatch in `GenerationRuntime.send_text` | `backend/generation_service.py` |

### P2 — Quality & observability

| # | Fix | File(s) |
|---|---|---|
| 10 | DRY extraction (`asNonNegativeInt`, `refreshQuota`) | `frontend/lib/utils.ts` (new), `frontend/lib/useQuota.ts` (new) |
| 11 | `trace_id` + `project_id` on all backend log calls | `backend/generation_service.py`, `backend/agents/*.py` |
| 12 | `/health/ready` endpoint with DB probe | `backend/main.py` |
| 13 | Single-worker guard + documentation | `backend/main.py`, `backend/CLAUDE.md` |
| 14 | Docs sync (CLAUDE.md, platform-docs.md, vision.md) | `CLAUDE.md`, `documents/platform-docs.md`, `documents/vision.md` |

---

## Decisions Made

| Topic | Decision |
|---|---|
| Review mode | HOLD SCOPE |
| Multi-worker | Accept single-worker limit, document + guard, fix in V1 |
| Architect parse failures | Log + count; raise after 3 consecutive bad lines after first valid node |
| asyncio.gather failure | Replace with asyncio.TaskGroup |
| send_text complexity | Type-dispatch table (dict mapping msg_type → handler coroutine) |
| Testing | Write failing test before each fix (CLAUDE.md rule) |
| Sync DB calls | asyncio.to_thread for all Supabase calls |
| Infracost blocking | asyncio.to_thread + subprocess.run |
| CORS | ALLOWED_ORIGINS env var, comma-separated, default: http://localhost:3000 |
| Log context | Add trace_id + project_id to all logger calls |
| Health check | Add /health/ready with Supabase DB probe |
| Agent sequencing | Fix now — architect runs first, node list passed to coder/cost/description |
| Canvas edit | Fix now — implement full Terraform regeneration on canvas change |
| DRY violations | Extract to lib/utils.ts and lib/useQuota.ts |
| Docs sync | Sync all three docs in this session |

---

## NOT In Scope (This Plan)

| Item | Rationale |
|---|---|
| Redis pub/sub broadcaster | V1 item, single-worker is documented and guarded |
| Full test coverage | Write tests for bugs being fixed only |
| Structured JSON logging (structlog) | Add trace_id to existing logger calls is sufficient for now |
| Terraform validation (tfsec) | V1 quality sprint |
| Canvas undo/redo | V2 |
| Real-time multiplayer | V2 |
| Templates library | V1 |
| Deploy button | V3 |

---

## What Already Exists (Don't Rebuild)

- `ProjectBroadcaster` — solid pub/sub with dead socket cleanup ✓
- `PersistenceState` — clean upsert semantics ✓
- `_safe_send_json` pattern — disciplined WS error handling ✓
- Coder agent fallback chain (tool use → JSON fallback → error) ✓
- Test infrastructure (`conftest.py`, WS tests, project store tests, admin tests) ✓
- Frontend `debugEvents` + `copyDebugReport` — excellent user-facing observability ✓
- `trace_id` flows from backend to frontend ✓

---

## Dream State Delta

```
CURRENT STATE                    THIS PLAN                    12-MONTH IDEAL
─────────────────────────────────────────────────────────────────────────────
• Full pipeline working         • Fix 10 critical bugs        • Multi-user collab
• Auth (Supabase OAuth)         • Sync docs to code           • Terraform validation
• Quota (5 free)                • canvas_edit actually works  • Real Infracost API key
• Sharing via slug              • Atomic quota                • Canvas undo/redo
• Post-gen chat                 • Async DB calls              • Templates library
• Docs severely outdated        • CORS for prod               • Deploy button (V3)
• canvas_edit is a stub         • Agent sequencing fixed
• Agents run out of order       • type-dispatch refactor
• Sync DB calls block loop      • /health/ready
• No trace_id in logs           • trace_id in all logs
```
