# Fix Architect WebSocket Reconnect Loop (Issue #171)

## Context

During the architect stage, the frontend can force a WebSocket reconnect every 15 seconds even when generation is healthy. The reconnect loop happens because the architect agent may spend 20-40 seconds producing the first newline-delimited JSON event, while the frontend stall detector expects pipeline progress within 15 seconds.

## Root Cause

`backend/agents/architect.py` buffers streamed LLM tokens until a complete line can be parsed as JSON. No `diagram_event` or `pipeline_event` is emitted during that initial quiet gap. The frontend therefore sees no progress, trips `STALL_THRESHOLD_MS`, and reconnects.

The server `ping` heartbeat is intentionally transport-only and must stay separate from pipeline progress semantics.

## Implementation Plan

### Step 1: Add regression coverage for the architect quiet gap
- Extend `backend/tests/agents/test_architect.py`
- Simulate a stream that delays the first newline-delimited event
- Assert that architect emits a progress `pipeline_event` before the first `diagram_event`
- Assert the keepalive task stops once the stream completes

### Step 2: Add architect-stage progress keepalives
- Update `backend/agents/architect.py`
- Start a small keepalive task before entering the architect stream loop
- Emit `pipeline_event` messages with `stage: "architect"` and `event: "still_streaming"`
- Cancel the task in `finally`
- Record first-event latency once for observability

### Step 3: Improve WebSocket observability
- Update `backend/ws_handler.py`
- Log connection, subscription, disconnect, and cleanup events with connection id
- Include subscribed project ids and generation trace ids when available
- Avoid assuming trace context exists before subscription

### Step 4: Improve frontend stall diagnostics
- Update `frontend/lib/useCanvasPipeline.ts`
- Keep behavior the same, but enrich stall and reconnect debug events with stage, project id, quiet age, and socket state

### Step 5: Update documented data contracts
- Update `documents/platform-docs.md` and `documents/data-reference.md`
- Document the architect keepalive `pipeline_event`

## Files to Modify

| File | Changes |
|------|---------|
| `backend/agents/architect.py` | Architect keepalive + first-event latency logging |
| `backend/tests/agents/test_architect.py` | Quiet-gap regression coverage |
| `backend/ws_handler.py` | Richer connection/subscription/disconnect logging |
| `frontend/lib/useCanvasPipeline.ts` | Better stall/reconnect diagnostics |
| `documents/platform-docs.md` | Document architect keepalive event |
| `documents/data-reference.md` | Document architect progress event semantics |

## Verification

1. Run `uv run --directory backend pytest tests/agents/test_architect.py -q`
2. Run `pnpm exec vitest run lib/__tests__/websocket.test.ts`
3. Run a local generation and confirm architect no longer causes reconnect loops while the first node is pending
