# Manual Terraform Generation — Design Spec

**Issue:** #100
**Date:** 2026-03-25
**Status:** Approved

## Problem

Terraform generation is coupled to the architect agent run. Users cannot regenerate Terraform independently from their current canvas state. There is no standalone trigger and no observability into the coder agent's execution.

## Solution

Decouple Terraform generation into an explicit user action via the existing "Generate Terraform" TopBar button. The coder agent runs standalone using the current canvas state (diagram_nodes from DB) plus original requirements. Full observability on server (structured logging with trace IDs) and client (pipeline events).

## Data Flow

```
User clicks "Generate Terraform" in TopBar
  → Frontend sends { type: "generate_terraform", project_id, access_token }
  → ws_handler validates auth + project ownership
  → Creates trace_id, logs start with node count
  → Sends pipeline_event (stage="coder", status="started")
  → Calls rerun_project_agents_for_user(agent_names=["coder"])
  → Coder agent receives diagram_nodes (from DB) + requirements
  → Streams terraform_file messages back to frontend
  → Frontend updates OutputPanel progress
  → Done message sent, logs completion with timing + file count
```

## Button States

The TopBar "Generate Terraform" button has three states:

1. **Ready** (no terraform files yet): Blue "Generate Terraform" button → sends `generate_terraform` WS message
2. **Generating** (in progress): Disabled with spinner/loading text "Generating..."
3. **Complete** (terraform files exist): "See Terraform Code" → toggles right panel open/closed

After a new architect run clears terraform files, the button reverts to state 1.

## WS Message Contract

### Client → Server
```json
{ "type": "generate_terraform", "project_id": "uuid", "access_token": "jwt" }
```

### Server → Client (pipeline events)
```json
{ "type": "pipeline_event", "stage": "coder", "status": "started", "project_id": "...", "trace_id": "..." }
{ "type": "pipeline_event", "stage": "coder", "status": "generating", "detail": "Emitted file 1", "project_id": "...", "trace_id": "..." }
{ "type": "pipeline_event", "stage": "coder", "status": "completed", "project_id": "...", "trace_id": "..." }
```

Existing `terraform_file` and `done` messages unchanged.

## Backend Changes

### ws_handler.py
- Add `generate_terraform` message handler
- Validate auth + project ownership
- Generate trace_id, structured log: trace_id, project_id, user_id, node_count, timestamp
- Send pipeline_event (started)
- Call `rerun_project_agents_for_user(agent_names=["coder"])`
- Log completion: duration_ms, file_count
- Send pipeline_event (completed) + done

### generation_service.py
No changes. Existing `rerun_project_agents_for_user()` already supports running just the coder agent with current diagram_nodes + requirements.

### coder.py
No changes. Already accepts diagram_nodes + requirements.

## Frontend Changes

### useCanvasPipeline.ts
- Remove auto-trigger of coder after architect completes
- Add `generateTerraform()` function: sends `{ type: "generate_terraform", project_id, access_token }`, resets terraform progress state
- Track `hasTerraformFiles` derived state for button mode

### TopBar.tsx
- Wire "Generate Terraform" button to `generateTerraform()` callback
- Implement three button states (ready / generating / complete)
- "See Terraform Code" state toggles right panel via existing `onToggleRightPanel` callback

### OutputPanel
No changes needed. Already handles `terraform_file` messages and progress display.

## Observability

### Server-side (Python logging)
- `logger.info` on generation start: trace_id, project_id, user_id, node_count
- `logger.info` on generation complete: trace_id, duration_ms, file_count
- `logger.error` on failure: trace_id, error message, stack trace

### Client-side (pipeline events)
- `pipeline_event` messages for status transitions: started → generating → completed/failed
- Error paths: server sends `error` WS message, frontend shows error state

## What stays the same
- Coder agent logic and prompt unchanged
- Terraform file format unchanged
- OutputPanel rendering unchanged
- Canvas edit → rerun flow unchanged (still triggers coder + description)
- Description agent not affected
