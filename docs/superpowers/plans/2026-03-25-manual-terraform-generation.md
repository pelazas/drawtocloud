# Manual Terraform Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple Terraform generation from the architect pipeline into an explicit user action with full observability.

**Architecture:** Add a `generate_terraform` WS message type. Backend handler validates auth/ownership, then calls existing `rerun_project_agents_for_user(agent_names=["coder"])`. Frontend wires the existing TopBar button with three states (generate / generating / see code) and adds a `generateTerraform()` function to `useCanvasPipeline`.

**Tech Stack:** FastAPI (Python), Next.js 14, React Flow, WebSockets, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-manual-terraform-generation-design.md`

---

### Task 1: Backend — Add `generate_terraform` WS handler

**Files:**
- Modify: `backend/ws_handler.py:421-428` (add to auth-required message types set)
- Modify: `backend/ws_handler.py` (add new `elif` branch after the `canvas_edit` handler block ends)

- [ ] **Step 1: Add `generate_terraform` to the auth-required message types set**

In `ws_handler.py` around line 421, add `"generate_terraform"` to the set of message types that require auth:

```python
if msg_type in {
    "start_generation",
    "subscribe_project",
    "chat",
    "canvas_edit",
    "chat_discovery_start",
    "chat_plan_approve",
    "generate_terraform",
}:
```

- [ ] **Step 2: Add the `generate_terraform` handler**

After the `canvas_edit` handler block ends (find the last `elif` in the message dispatch chain and add after it), add a new `elif` branch. This handler:
1. Validates `project_id` is present
2. Fetches the project row and verifies ownership
3. Guards against empty canvas (node_count == 0)
4. Generates a `trace_id`, logs start with structured fields
5. Subscribes the websocket to the project for broadcast delivery
6. Calls `rerun_project_agents_for_user(agent_names=["coder"])` — this queues the async rerun and returns immediately with a trace_id
7. Logs the queued trace_id (actual completion/file-count observability comes from existing pipeline_event broadcasts in generation_service)
8. Handles errors with structured logging + error WS message

**Important:** `rerun_project_agents_for_user` is async — it queues the coder rerun in a background task. The handler logs "queued" after the call returns, NOT "complete". Actual completion is observed via existing `pipeline_event` and `done` messages that the generation_service broadcasts to subscribed websockets.

```python
        elif msg_type == "generate_terraform":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for generate_terraform.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            node_count = len(project_row.get("nodes") or [])
            if node_count == 0:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "no_diagram_nodes",
                        "message": "Cannot generate Terraform: no nodes on canvas. Design your architecture first.",
                    },
                ):
                    break
                continue

            tf_trace_id = str(uuid4())
            logger.info(
                "generate_terraform.start trace_id=%s project_id=%s user_id=%s node_count=%d",
                tf_trace_id, project_id, user_id, node_count,
            )

            await subscribe_websocket(project_id, websocket)
            subscribed_projects.add(project_id)

            try:
                rerun_result = await rerun_project_agents_for_user(
                    user_id=user_id or "",
                    user_email=user_email or "",
                    project_id=project_id,
                    agent_names=["coder"],
                )
                rerun_trace = rerun_result.get("trace_id")
                logger.info(
                    "generate_terraform.queued trace_id=%s project_id=%s rerun_trace=%s",
                    tf_trace_id, project_id, rerun_trace,
                )
            except GenerationStartError as error:
                logger.error(
                    "generate_terraform.failed trace_id=%s project_id=%s error=%s",
                    tf_trace_id, project_id, error.message,
                )
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": error.code,
                        "message": error.message,
                    },
                ):
                    break
                continue
            except Exception as error:
                logger.error(
                    "generate_terraform.failed trace_id=%s project_id=%s error=%s",
                    tf_trace_id, project_id, str(error),
                    exc_info=True,
                )
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "terraform_generation_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue
```

- [ ] **Step 3: Update the WS handler docstring**

Add `generate_terraform` to the docstring at line 364-392:

In accepted message types, add:
```
      - generate_terraform: { type, project_id, access_token|auth_token }
```

- [ ] **Step 4: Commit**

```bash
git add backend/ws_handler.py
git commit -m "feat(backend): add generate_terraform WS handler with observability (#100)"
```

---

### Task 2: Frontend — Add `generateTerraform` function to `useCanvasPipeline`

**Files:**
- Modify: `frontend/lib/useCanvasPipeline.ts:1364-1400` (add function + expose in return)

- [ ] **Step 1: Add `generateTerraform` function**

Add a new function before the `return` statement (around line 1363), after `loadTemplateSnapshot`:

```typescript
  const generateTerraform = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId) return;

    recordDebugEvent("Manual Terraform generation requested", {
      stage: "coder",
      details: { project_id: projectId },
    });

    setTerraformFiles([]);
    setTerraformProgress({
      status: "requesting",
      activity: "Requesting Terraform generation...",
      emittedCount: 0,
      expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
      currentFile: null,
      lastUpdateAt: Date.now(),
    });

    const payload = await withAccessToken({
      type: "generate_terraform",
      project_id: projectId,
    });
    wsClient.send(payload);
  }, [activeProjectId, recordDebugEvent]);
```

- [ ] **Step 2: Expose `generateTerraform` and `terraformFiles` in the return object**

Add `generateTerraform` to the return object at line 1364:

```typescript
  return {
    ...diagram,
    // ... existing fields ...
    generateTerraform,
    // ... rest of existing fields ...
  };
```

(Add it after `loadTemplateSnapshot` in the return object.)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/useCanvasPipeline.ts
git commit -m "feat(frontend): add generateTerraform function to pipeline hook (#100)"
```

---

### Task 3: Frontend — Update TopBar button states

**Files:**
- Modify: `frontend/components/TopBar.tsx` (add props for button state, implement 3 states)

- [ ] **Step 1: Update TopBar props and button implementation**

Replace the current TopBar props and button with three-state logic:

```typescript
"use client";

import { FileCode, FolderOpen, Layout, Loader2, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import UserMenu from "@/components/UserMenu";

interface TopBarProps {
  user: User | null;
  onDescribeApp?: () => void;
  onTemplates?: () => void;
  onMyDesigns?: () => void;
  onAutoLayout?: () => void;
  onGenerateTerraform?: () => void;
  onSeeTerraformCode?: () => void;
  terraformButtonState: "generate" | "generating" | "view";
  onSignIn?: () => void;
}

export default function TopBar({
  user,
  onDescribeApp,
  onTemplates,
  onMyDesigns,
  onAutoLayout,
  onGenerateTerraform,
  onSeeTerraformCode,
  terraformButtonState,
  onSignIn,
}: TopBarProps) {
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-700/80 bg-gray-800/90 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-100 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar";

  function renderTerraformButton() {
    const baseClass =
      "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-white transition-colors whitespace-nowrap font-topbar";

    if (terraformButtonState === "generating") {
      return (
        <button
          type="button"
          disabled
          className={`${baseClass} bg-blue-600/60 cursor-not-allowed`}
        >
          <Loader2 size={14} className="animate-spin" />
          Generating...
        </button>
      );
    }

    if (terraformButtonState === "view") {
      return (
        <button
          type="button"
          onClick={onSeeTerraformCode}
          className={`${baseClass} bg-gray-700 hover:bg-gray-600`}
        >
          <FileCode size={14} />
          See Terraform Code
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={onGenerateTerraform}
        className={`${baseClass} bg-blue-600 hover:bg-blue-500`}
      >
        <FileCode size={14} />
        Generate Terraform
      </button>
    );
  }

  return (
    <div className="border-b border-gray-700 bg-gray-900 relative z-40">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          <h1 className="text-sm font-medium text-white pr-2 tracking-[0.02em]">
            draw<span className="font-black">to</span>cloud
          </h1>

          <button type="button" onClick={onDescribeApp} className={buttonClass}>
            <Sparkles size={14} />
            Describe your app
          </button>

          <button type="button" onClick={onTemplates} className={buttonClass}>
            Templates
          </button>

          <button type="button" onClick={onMyDesigns} className={buttonClass}>
            <FolderOpen size={14} />
            My Designs
          </button>

          <button type="button" onClick={onAutoLayout} className={buttonClass}>
            <Layout size={14} />
            Auto Layout
          </button>
        </div>

        <div className="flex items-center gap-3">
          {renderTerraformButton()}

          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-200 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/TopBar.tsx
git commit -m "feat(frontend): three-state terraform button in TopBar (#100)"
```

---

### Task 4: Frontend — Wire TopBar + page.tsx integration

**Files:**
- Modify: `frontend/app/page.tsx:42-55` (update `handleGenerateTerraform`, add props)

- [ ] **Step 1: Compute `terraformButtonState` and update handler in page.tsx**

Replace the `handleGenerateTerraform` function (lines 42-55) and add the button state computation. Also update the TopBar props:

```typescript
  const terraformButtonState: "generate" | "generating" | "view" = (() => {
    if (
      pipeline.terraformProgress.status === "requesting" ||
      pipeline.terraformProgress.status === "planning" ||
      pipeline.terraformProgress.status === "generating"
    ) {
      return "generating";
    }
    if (pipeline.terraformFiles.length > 0) {
      return "view";
    }
    return "generate";
  })();

  function handleGenerateTerraform() {
    if (!workspace.requireAuth()) return;

    if (!workspace.currentProject) {
      void workspace.startFromScratch();
      return;
    }

    void pipeline.generateTerraform();
  }

  function handleSeeTerraformCode() {
    // Toggle: if right panel is already open on output tab, close it; otherwise open it.
    // `rightPanelOpen`, `rightPanelTab`, and `closeRightPanel` are already exposed from useWorkspace.
    if (workspace.rightPanelOpen && workspace.rightPanelTab === "output") {
      workspace.closeRightPanel();
    } else {
      workspace.openOutput();
    }
  }
```

- [ ] **Step 2: Update the TopBar component props in the JSX**

Update the `<TopBar>` component usage to pass the new props:

```tsx
<TopBar
  user={workspace.user}
  onDescribeApp={handleDescribeApp}
  onTemplates={handleTemplates}
  onMyDesigns={workspace.openMyDesigns}
  onAutoLayout={handleAutoLayout}
  onGenerateTerraform={handleGenerateTerraform}
  onSeeTerraformCode={handleSeeTerraformCode}
  terraformButtonState={terraformButtonState}
  onSignIn={() => {
    workspace.requireAuth();
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(frontend): wire terraform button states to pipeline (#100)"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `backend/ws_handler.py` docstring (already done in Task 1 Step 3)
- Modify: `documents/platform-docs.md` (add `generate_terraform` WS message type)
- Modify: `documents/data-reference.md` (document the new message shape)
- Modify: `CLAUDE.md` (add `generate_terraform` to WS message types table)
- Modify: `backend/CLAUDE.md` (add `generate_terraform` to WS message types)

- [ ] **Step 1: Update CLAUDE.md WebSocket Message Types**

In the root `CLAUDE.md`, add to the `Client → Server` section:

```
{ "type": "generate_terraform", "project_id": "...", "access_token": "..." }
```

- [ ] **Step 2: Update documents/platform-docs.md**

Add the new `generate_terraform` message type to the WebSocket message types section.

- [ ] **Step 3: Update documents/data-reference.md**

Add the `generate_terraform` message shape to the data reference.

- [ ] **Step 4: Update backend/CLAUDE.md**

Add `{ "type": "generate_terraform", "project_id": "...", "access_token": "..." }` to the `Client → Server` WS messages section.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md backend/CLAUDE.md documents/platform-docs.md documents/data-reference.md
git commit -m "docs: add generate_terraform WS message to documentation (#100)"
```

---

### Task 6: Manual integration test

- [ ] **Step 1: Start the dev environment**

```bash
cd /Users/pelazas/conductor/workspaces/drawtocloud/rabat && ./dev.sh
```

Or separately:
```bash
cd backend && uv run uvicorn main:app --reload &
cd frontend && pnpm dev &
```

- [ ] **Step 2: Verify the happy path**

1. Sign in, create a project with "Describe your app" → generate architecture
2. After architect completes, verify the blue "Generate Terraform" button appears (not auto-triggered)
3. Click "Generate Terraform"
4. Verify: button shows "Generating..." with spinner
5. Verify: terraform files stream into the right panel
6. After completion: button shows "See Terraform Code"
7. Click "See Terraform Code" → right panel toggles open/closed
8. Check backend logs for `generate_terraform.start` and `generate_terraform.complete` with trace_id and timing

- [ ] **Step 3: Verify error handling**

1. Try "Generate Terraform" with no nodes on canvas → expect error message
2. Check backend logs show structured error entry
