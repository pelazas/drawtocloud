# TODOS

Deferred work items from the 2026-03-17 codebase review. Items not in scope for MVP but tracked here so they are not lost.

---

## TODO-1: Migrate `@app.on_event` to FastAPI lifespan

**What:** Replace the deprecated `@app.on_event("startup")` with a `lifespan` async context manager in `main.py`.

**Why:** FastAPI has deprecated `on_event` — it will be removed in a future version. A forced upgrade would break the startup guard.

**Pros:** Eliminates DeprecationWarning in test output; aligns with current FastAPI idioms; enables a shutdown hook if needed later.

**Cons:** Minor mechanical refactor, no behavior change.

**Context:** The `_enforce_single_worker` startup hook was already migrated to the new `_lifespan` handler in this session (combining it with the startup cleanup). The deprecation warning is gone. This TODO is resolved — keeping entry for tracking.

**Status:** ✅ Done in 2026-03-17 session.

**Effort:** XS | **Priority:** P2

---

## TODO-2: DRY — extract `_enrich_requirements` to `agents/utils.py`

**What:** `_enrich_requirements(requirements, diagram_nodes)` is defined identically in both `agents/coder.py` and `agents/cost_analyst.py`. Move to a shared `agents/utils.py`.

**Why:** If the enrichment logic changes (e.g., adding edge data to the context), it must be updated in two places. They will drift.

**Pros:** Single source of truth; easy to test in isolation.

**Cons:** Introduces a new file; very minor overhead.

**Context:** Both functions produce a dict `{**requirements, "architect_diagram": [node summaries]}`. Both are identical today. See `coder.py:132-144` and `cost_analyst.py:34-46`.

**Status:** ✅ Done in 2026-03-17 session.

**Effort:** XS | **Priority:** P3 | **Depends on:** Nothing

---

## TODO-3: Single-worker guard — protect against `--workers` CLI bypass

**What:** The `WEB_CONCURRENCY` env var guard in `main.py` doesn't catch `uvicorn main:app --workers 2` passed as a CLI flag. Both workers would start with `WEB_CONCURRENCY=1` and both would pass the guard.

**Why:** A future Dockerfile change adding `--workers` would silently break WebSocket delivery — clients subscribed to worker A won't receive events from worker B.

**Pros:** Prevents a hard-to-diagnose production bug.

**Cons:** Detecting uvicorn's worker count from inside the app is non-trivial (requires inspecting `sys.argv` or uvicorn internals).

**Context:** The real fix is Redis pub/sub (see TODO-5 scope). This guard is a safety net for the in-memory era. See `main.py:_lifespan`.

**Status:** ✅ Done in 2026-03-17 session.

**Effort:** S | **Priority:** P2 | **Depends on:** Nothing (standalone guard improvement)

---

## TODO-4: `append_chat_history` — replace with atomic Supabase JSONB RPC

**What:** `generation_service.append_chat_history` does a read-modify-write (read full row, append to list, write back). Two concurrent appends to the same project can produce a lost update.

**Why:** Single-worker prevents this today, but it's a latent bug that will become real if we add concurrency or switch to a Redis-backed multi-worker setup.

**Pros:** Correct under all concurrency models; enables safe multi-worker future.

**Cons:** Requires a new Supabase migration and RPC (`append_chat_message(project_id uuid, message jsonb)`).

**Context:** Pattern: `supabase.rpc("append_chat_message", {"p_id": project_id, "msg": {...}}).execute()`. The RPC would use `jsonb_array_append` or equivalent. See `generation_service.py:417-421`.

**Effort:** M | **Priority:** P2 | **Depends on:** Supabase migration

---

## TODO-5: Quota system — replace in-memory user lock with DB-level atomic check+increment

**What:** The current quota TOCTOU fix (per-user `asyncio.Lock`) works for single-worker but is not safe under horizontal scaling. The correct fix is an atomic Supabase RPC that checks and increments in one transaction.

**Why:** When Redis pub/sub is added and multi-worker becomes possible, the in-memory lock will no longer serialize cross-worker requests. Two workers could still both pass the quota check.

**Pros:** Correct under any concurrency; removes in-memory lock state; cleaner architecture.

**Cons:** Requires a new Supabase migration and RPC. The existing `increment_generations_used` RPC already does the increment atomically — the check just needs to be folded in.

**Context:** Existing RPC: `increment_generations_used(user_id)` — does `UPDATE ... WHERE generations_used < generations_limit RETURNING *`. The quota check could be merged: add a `check_and_reserve_quota(user_id)` RPC that raises/returns error if limit reached, otherwise increments. See `quota.py` and `generation_service.py:start_generation_for_user`.

**Effort:** M | **Priority:** P1 | **Depends on:** Supabase migration; prerequisite for multi-worker support
