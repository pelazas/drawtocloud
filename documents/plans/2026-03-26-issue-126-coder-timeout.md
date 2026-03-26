# Fix Coder Agent Timeout Bug (Issue #126)

## Context

The coder agent (Terraform generation) consistently fails with `coder.json_timeout` errors. The user reports it "never works on time, likely bugged." The root cause is a combination of a missing HTTP timeout on the tool-use Anthropic client, uncoordinated timeout layers, and insufficient observability.

## Root Cause Analysis

### Bug 1: Missing httpx timeout on tool-use client
`coder.py:310` creates `anthropic.AsyncAnthropic(api_key=api_key)` with **no timeout**. SDK default is 600s. Every other Anthropic client in the codebase passes `timeout=HTTP_CLIENT_TIMEOUT` (read=90s). Without it, a stalled connection hangs for 10 minutes before failing.

### Bug 2: No inner timeout on tool-use path
`PRIMARY_REQUEST_TIMEOUT_SECONDS = 120` is defined at `coder.py:14` but **never used**. The tool-use path has no `asyncio.wait_for` wrapper — it relies entirely on the outer 220s timeout from `generation_service.py`. When that outer timeout fires, it raises `CancelledError` (not `TimeoutError`), so the `except asyncio.TimeoutError` fallback handler at line 204 is **never triggered** via the outer timeout.

### Bug 3: Fallback timeout too short
`FALLBACK_REQUEST_TIMEOUT_SECONDS = 120` wraps a call generating up to 16384 tokens of dense HCL. If the model sends data steadily but total generation exceeds 120s, the timeout kills it.

### Bug 4: No observability
No logging between "request started" and "file emitted." Can't distinguish model thinking vs connection stall vs timeout math issues.

## Implementation Plan

### Step 1: Fix the Anthropic client timeout (`coder.py`)
- Add `HTTP_CLIENT_TIMEOUT` import from `llm_client`
- Pass `timeout=HTTP_CLIENT_TIMEOUT` to `anthropic.AsyncAnthropic()` at line 310

### Step 2: Add inner timeout to tool-use path (`coder.py`)
- Rename `PRIMARY_REQUEST_TIMEOUT_SECONDS` → `TOOL_USE_TIMEOUT_SECONDS = 180`
- Wrap `_stream_via_tool_use()` call at line 195 with `asyncio.wait_for(..., timeout=TOOL_USE_TIMEOUT_SECONDS)`
- This makes the `except asyncio.TimeoutError` at line 204 actually reachable from the tool-use path
- Increase `FALLBACK_REQUEST_TIMEOUT_SECONDS` from 120 → 180

### Step 3: Increase outer timeout (`generation_service.py`)
- Change `attempt_timeout_seconds` for coder from 220 → 300
- Rationale: tool-use (180s max) + fallback (up to 120s remaining) = 300s outer

### Step 4: Add observability to `_stream_via_tool_use` (`coder.py`)
Add structured logging at these points:
1. **Stream opened** — right after entering `async with client.messages.stream(...)`, before the event loop
2. **First event** — time-to-first-token metric (ms from stream open to first event)
3. **Per-block completion** — file name, JSON size, time since last block, cumulative emitted count
4. **Stream done** — total duration, event count, files emitted, stop_reason

### Step 5: Add observability to `_stream_via_json_complete` (`coder.py`)
- Log effective timeout and fallback flag at request start
- Log response size on success

### Step 6: Update tests (`test_coder.py`)
- Rename `PRIMARY_REQUEST_TIMEOUT_SECONDS` → `TOOL_USE_TIMEOUT_SECONDS` in test imports
- Update `test_timeout_constants_are_sufficient` to assert >= 180
- Verify `anthropic.AsyncAnthropic` is called with `timeout` kwarg in existing test

## Files to Modify

| File | Changes |
|------|---------|
| `backend/agents/coder.py` | Fix client timeout, add tool-use `wait_for`, rename constant, increase fallback timeout, add logging |
| `backend/generation_service.py` | Increase coder `attempt_timeout_seconds` 220 → 300 |
| `backend/tests/agents/test_coder.py` | Update constant names and assertions |

## Verification

1. Run `cd backend && python -m pytest tests/agents/test_coder.py -v` — all tests pass
2. Start backend locally, trigger Terraform generation via the UI, observe backend logs for new `coder.tool_use.*` log lines
3. Verify no `coder.json_timeout` errors on normal-complexity architectures
