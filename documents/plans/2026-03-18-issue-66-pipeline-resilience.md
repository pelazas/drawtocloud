# Issue #66 Pipeline Resilience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make specialist execution resilient so one specialist failure does not fail the full pipeline, with independent retries, attempt timeouts, and incremental completion semantics.

**Architecture:** Keep stage order `requirements -> architect -> specialists_parallel`. Replace the current fail-fast TaskGroup specialist execution with a shared orchestration helper that runs each specialist in its own retry loop with hard attempt timeout, emits per-specialist lifecycle events, and returns a terminal summary used by both full generation and rerun paths.

**Tech Stack:** Python 3.12, asyncio, FastAPI runtime layer, pytest.

---

## File Structure

- Modify: `backend/generation_service.py`
  - Add shared specialist orchestration utilities, retry state tracking, heartbeat emission, and terminal summary semantics.
  - Apply shared helper in both `_run_generation` and `_run_agent_rerun`.
- Modify: `backend/agents/cost_analyst.py`
  - Add hard timeout wrappers for primary and fallback LLM calls.
- Modify: `backend/agents/description.py`
  - Add hard timeout wrapper for LLM call.
- Modify: `backend/tests/test_generation_service.py`
  - Add tests for independent retries, partial success, and terminal pipeline semantics.
- Modify: `backend/tests/agents/test_cost_analyst.py`
  - Add timeout behavior tests.
- Modify: `backend/tests/agents/test_description.py` (create)
  - Add timeout behavior tests for description agent.
- Modify: `documents/data-reference.md`
  - Document new pipeline event semantics and terminal summary payload.

## Tasks

### Task 1: Shared specialist orchestration helper (test-first)

**Files:**
- Modify: `backend/tests/test_generation_service.py`
- Modify: `backend/generation_service.py`

- [ ] **Step 1: Write failing tests**
  - Specialist failure does not fail full generation when siblings can complete.
  - Per-specialist retry attempts are independent.
  - Pipeline emits terminal `completed` with specialist summary showing success/failure counts.

- [ ] **Step 2: Run targeted tests and confirm failure**
  - Run: `cd backend && uv run pytest tests/test_generation_service.py -k "specialist or pipeline" -q`

- [ ] **Step 3: Implement shared helper in generation_service**
  - Introduce specialist config/state model with `queued -> running -> retrying(n) -> completed|failed_after_retries`.
  - Add bounded per-attempt timeout and retry/backoff.
  - Emit incremental completion events and heartbeat `still_running` while attempts are active.
  - Return terminal summary for caller.

- [ ] **Step 4: Re-run targeted tests and make green**
  - Run: `cd backend && uv run pytest tests/test_generation_service.py -q`

### Task 2: Apply helper to rerun path (test-first)

**Files:**
- Modify: `backend/tests/test_generation_service.py`
- Modify: `backend/generation_service.py`

- [ ] **Step 1: Write failing rerun test**
  - Rerun should complete with partial success if one selected specialist fails after retries.

- [ ] **Step 2: Run rerun-focused tests and confirm failure**
  - Run: `cd backend && uv run pytest tests/test_generation_service.py -k rerun -q`

- [ ] **Step 3: Integrate shared helper into `_run_agent_rerun`**
  - Replace TaskGroup fail-fast rerun with shared orchestration and terminal summary behavior.

- [ ] **Step 4: Re-run rerun tests and make green**
  - Run: `cd backend && uv run pytest tests/test_generation_service.py -k rerun -q`

### Task 3: Agent hard timeouts (test-first)

**Files:**
- Modify: `backend/tests/agents/test_cost_analyst.py`
- Create: `backend/tests/agents/test_description.py`
- Modify: `backend/agents/cost_analyst.py`
- Modify: `backend/agents/description.py`

- [ ] **Step 1: Add failing timeout tests**
  - Cost analyst primary/fallback LLM calls time out and surface pipeline warning/error event paths.
  - Description LLM call timeout emits parse/timeout failure event without crashing.

- [ ] **Step 2: Run targeted tests and confirm failure**
  - Run: `cd backend && uv run pytest tests/agents/test_cost_analyst.py tests/agents/test_description.py -q`

- [ ] **Step 3: Implement timeouts**
  - Wrap `async_complete` calls with `asyncio.wait_for` using shared constants.
  - Emit explicit timeout pipeline events for observability.

- [ ] **Step 4: Re-run targeted tests and make green**
  - Run: `cd backend && uv run pytest tests/agents/test_cost_analyst.py tests/agents/test_description.py -q`

### Task 4: Contracts + verification

**Files:**
- Modify: `documents/data-reference.md`
- Modify: `backend/tests/test_generation_service.py`

- [ ] **Step 1: Update docs for new pipeline event details and terminal summary payload**
- [ ] **Step 2: Add or update assertions for event payload shape**
- [ ] **Step 3: Run full relevant backend test suites**
  - Run: `cd backend && uv run pytest tests/test_generation_service.py tests/agents/test_cost_analyst.py tests/agents/test_description.py -q`
- [ ] **Step 4: Optional broader confidence run**
  - Run: `cd backend && uv run pytest -q`
