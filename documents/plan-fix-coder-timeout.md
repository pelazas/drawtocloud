# Plan: Fix Coder Agent TimeoutError (#37)

## Problem
`_stream_via_json_complete` wraps `async_complete()` in `asyncio.wait_for(timeout=45)`. Terraform generation for 4 files easily exceeds 45s on non-Anthropic providers, causing `TimeoutError`. The Anthropic tool-use path has 60s which may also be too short.

## Tasks

### Task 1: Write failing test
Add a test in `backend/tests/agents/test_coder.py` that mocks `async_complete` to sleep >45s and asserts `stream_terraform_files` does NOT raise `TimeoutError`.

**Verify:** Test fails before fix.

### Task 2: Increase timeouts
In `backend/agents/coder.py`:
- `PRIMARY_REQUEST_TIMEOUT_SECONDS`: 60 → 120
- `FALLBACK_REQUEST_TIMEOUT_SECONDS`: 45 → 120

**Verify:** Test from Task 1 passes.

### Task 3: Run full test suite
Run `cd backend && python -m pytest tests/agents/test_coder.py -v` to confirm no regressions.
