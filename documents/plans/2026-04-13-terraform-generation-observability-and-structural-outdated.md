# Terraform Generation Observability And Structural Outdated Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show manual Terraform generation inside the existing generation observability panel as a fourth `Coder` step, and only mark Terraform as outdated when the architecture structure changes rather than when the canvas layout changes.

**Architecture:** Reuse the existing architecture-generation agent cards by deriving a synthetic frontend-only `Coder` agent from `terraformProgress` and appending it below the last known initial-generation `Requirements`, `Architect`, and `Cost analysis` rows when those rows are present in client state. If those architecture rows are unavailable, fall back to rendering a standalone `Coder` row. Separately, add a `structure_changed` flag to snapshot persistence so visual-only saves such as Auto Layout update stored nodes/edges without bumping `architecture_modified_at`, `terraform_outdated`, or setup-PDF stale state.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, FastAPI, Python 3.12, WebSockets, Vitest, pytest

---

## Chunk 1: Generation Panel And Coder Observability

### Task 1: Lock the desired Terraform-generation panel behavior with frontend tests

**Files:**
- Create: `frontend/lib/terraformGenerationObservability.ts`
- Create: `frontend/lib/__tests__/terraformGenerationObservability.test.ts`
- Modify: `frontend/lib/__tests__/generationObservability.test.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`

- [ ] **Step 1: Add a failing test for deriving a synthetic coder row from Terraform progress**
Assert that existing completed architecture agents remain intact and a fourth `coder` row is appended with the same `GenerationAgentState` shape when `terraformProgress.status` is `requesting`, `generating`, or `completed`.

- [ ] **Step 2: Add a failing test for the terminal coder copy**
Assert that a completed coder row uses the exact summary text `Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.` and reports success styling through `status: "completed"`.

- [ ] **Step 3: Add a failing test for the no-architecture-line rule**
Extract a small presentation helper that returns how many rows should be connected by the vertical dependency line, then assert that `Requirements -> Architect -> Cost analysis` stay connected while `Coder` is rendered as a standalone row below them.

- [ ] **Step 4: Add a failing test for preserving initial-generation rows during coder-only updates**
Extend `frontend/lib/__tests__/generationObservability.test.ts` or add a nearby pipeline-level test to assert that a `generation_agent_update` with `mode: "code_generation"` does not blow away the last known initial-generation chain that the panel needs to keep visible.

- [ ] **Step 5: Run the targeted frontend tests to confirm failure**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/terraformGenerationObservability.test.ts lib/__tests__/generationObservability.test.ts`
Expected: failures showing that manual Terraform generation still uses the separate code-generation card and coder-only updates can replace the architecture rows.

### Task 2: Replace the separate code-generation card with a synthetic `Coder` agent row

**Files:**
- Modify: `frontend/components/GenerationObservabilityPanel.tsx`
- Modify: `frontend/components/GenerationObservabilityPanel/AgentStepCard.tsx`
- Delete: `frontend/components/GenerationObservabilityPanel/CodeGenerationCard.tsx`
- Create or Modify: `frontend/lib/terraformGenerationObservability.ts`
- Modify: `frontend/lib/generationObservability.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`

- [ ] **Step 1: Introduce a small mapper for generation-panel rows**
Create `frontend/lib/terraformGenerationObservability.ts` with a pure function that accepts the current `generationAgents`, `terraformProgress`, and Terraform-file availability, then returns:
1. the rows to render,
2. whether a synthetic coder row should appear,
3. the last row index that should participate in the dependency line.

- [ ] **Step 2: Derive `Coder` from existing Terraform state only**
Map `terraformProgress.status` to `GenerationAgentState.status` without any backend changes:
`requesting|planning|generating|finalizing -> running`,
`completed -> completed`,
`failed -> failed`,
otherwise omit the coder row unless generated Terraform files already exist.

- [ ] **Step 3: Preserve the last known architecture chain in pipeline state**
Update the generation-observability parsing path so the frontend can distinguish `initial_generation` from `code_generation`. Keep the last known initial-generation agent list available for the panel instead of letting coder-only updates replace it.

- [ ] **Step 4: Render all four rows in the `generation` tab when possible**
Remove the `isCodeGeneration && terraformProgress` early-return branch in `GenerationObservabilityPanel.tsx` so the panel always renders the shared agent-row UI. Keep `Requirements`, `Architect`, and `Cost analysis` from the last known initial-generation snapshot when available, then append `Coder` underneath when manual Terraform generation is active or completed. If no architecture rows are available, render only the standalone `Coder` row.

- [ ] **Step 5: Keep `Coder` visually consistent but not connected**
Reuse `AgentStepCard` for the synthetic coder row. Add a `coder` icon mapping in `AgentStepCard.tsx` using a code/file icon from `lucide-react`. Update the connector rendering in `GenerationObservabilityPanel.tsx` so the vertical line ends after `Cost analysis` and does not extend behind `Coder`.

- [ ] **Step 6: Preserve the current generation tab shell**
Do not create a dedicated code-generation mode in the right panel. Keep the existing `generation` tab title and container; only change the rows inside it.

- [ ] **Step 7: Re-run the targeted frontend tests**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/terraformGenerationObservability.test.ts lib/__tests__/generationObservability.test.ts`
Expected: the panel model now exposes the synthetic coder row, preserves the architecture chain during coder-only updates, and passes the standalone-row connector logic.

### Task 3: Send manual Terraform generation to the generation tab instead of the output tab

**Files:**
- Modify: `frontend/app/usePageState.ts`
- Create: `frontend/app/__tests__/usePageState.test.ts`

- [ ] **Step 1: Add a failing test for manual Terraform tab routing**
Create `frontend/app/__tests__/usePageState.test.ts` and add a small state-focused test around the workspace/pipeline decision points so clicking `Generate Terraform` opens `generation` and no longer pre-opens `output` during generation.

- [ ] **Step 2: Open the generation panel when Terraform generation starts**
Change `handleGenerateTerraform()` in `frontend/app/usePageState.ts` to open the generation tab before dispatching `pipeline.generateTerraform()`. Remove the current `openOutput({ suppressNextGenerationAutoOpen: true })` behavior for this button path.

- [ ] **Step 3: Keep output access manual through the topbar CTA**
Leave the `See Terraform Code` button behavior unchanged so the output tab opens only when the user explicitly clicks it after generation completes.

- [ ] **Step 4: Verify button-state behavior still matches the request**
Confirm the topbar flow is `Generate Terraform -> Generating... -> See Terraform Code`, with the completed coder-row summary instructing the user to click the topbar button.

---

## Chunk 2: Only Structural Changes Mark Terraform Outdated

### Task 4: Add a snapshot contract for structural vs visual-only saves

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/project_store.py`
- Modify: `backend/tests/test_projects_endpoint.py`
- Modify: `backend/tests/test_project_store.py`
- Modify: `frontend/lib/projectApi.ts`

- [ ] **Step 1: Write a failing backend endpoint test for visual-only snapshot saves**
Extend `backend/tests/test_projects_endpoint.py` to send `{"nodes": [...], "edges": [...], "structure_changed": false}` and assert the endpoint forwards the new boolean to the persistence layer.

- [ ] **Step 2: Write a failing store test for visual-only saves**
Extend `backend/tests/test_project_store.py` to assert `_save_canvas_snapshot_sync(..., structure_changed=False)` updates `nodes`, `edges`, and `updated_at` but does not set `architecture_modified_at` or flip `setup_pdf_status` to `outdated`.

- [ ] **Step 3: Extend the snapshot request model**
Add `structure_changed: bool = True` to `SaveSnapshotRequest` in `backend/main.py`, then pass it through `save_snapshot_endpoint()` into `save_canvas_snapshot(...)`.

- [ ] **Step 4: Make project-store snapshot persistence conditional**
Update `backend/project_store.py` so `save_canvas_snapshot()` and `_save_canvas_snapshot_sync()` accept the new boolean and only touch `architecture_modified_at` plus `setup_pdf_status="outdated"` when `structure_changed` is true.

- [ ] **Step 5: Extend the frontend snapshot client**
Update `frontend/lib/projectApi.ts` so `saveSnapshot()` accepts an options object like `{ structureChanged?: boolean }` and serializes `structure_changed` in the PATCH payload.

- [ ] **Step 6: Re-run the targeted backend tests**
Run: `uv run pytest backend/tests/test_projects_endpoint.py backend/tests/test_project_store.py -q`
Expected: visual-only snapshot saves no longer mutate architecture timestamps or stale PDF state.

### Task 5: Stop visual-only canvas actions from marking Terraform stale

**Files:**
- Modify: `frontend/lib/useCanvasPipeline.ts`
- Modify: `frontend/app/usePageState.ts`
- Modify: `frontend/lib/__tests__/projectApi.test.ts`
- Create or Modify: `frontend/lib/__tests__/terraformOutdatedState.test.ts`

- [ ] **Step 1: Add a failing frontend test for visual-only persistence**
Add a pure helper or state-level test that reproduces the current bug: calling the persistence path for Auto Layout sets `terraformOutdated=true` even though only layout changed.

- [ ] **Step 2: Separate structural invalidation from snapshot persistence**
Refactor `scheduleCanvasPersist()` in `frontend/lib/useCanvasPipeline.ts` to accept an explicit mode such as `{ structureChanged: false }` for visual-only saves. Only set local `terraformOutdated` and local setup-PDF outdated state when `structureChanged` is true.

- [ ] **Step 3: Mark Auto Layout as visual-only**
Update the Auto Layout caller in `frontend/app/usePageState.ts` to persist with `structureChanged: false` after applying layout.

- [ ] **Step 4: Preserve stale-state behavior for real structural edits**
Keep existing structural-edit paths stale. Chat-approved graph mutations should continue to clear Terraform files / cost estimate and update `architecture_modified_at` on the backend. Do not regress real-change invalidation while fixing visual-only saves.

- [ ] **Step 5: Keep this bug fix scoped to Auto Layout unless new call sites already exist**
Confirm the current codebase still only uses `scheduleCanvasPersist()` from Auto Layout. Do not expand this issue into new drag/resize persistence behavior unless an existing visual-only caller is already wired.

- [ ] **Step 6: Re-run the targeted frontend tests**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/projectApi.test.ts lib/__tests__/terraformOutdatedState.test.ts`
Expected: visual-only persistence no longer sets Terraform outdated locally, and snapshot requests can carry `structure_changed: false`.

### Task 6: Update product and contract docs

**Files:**
- Modify: `documents/platform-docs.md`
- Modify: `documents/data-reference.md`

- [ ] **Step 1: Document the generation-tab behavior for manual Terraform runs**
Update `documents/platform-docs.md` so the generation panel description says manual Terraform generation reuses the same panel and shows the last known `Requirements`, `Architect`, `Cost analysis` rows when available, with a standalone `Coder` row beneath them.

- [ ] **Step 2: Document the coder-card terminal message**
Capture the exact success copy in the product docs so the UI string remains intentional and testable.

- [ ] **Step 3: Document the snapshot payload change**
Update `documents/data-reference.md` to include the optional `structure_changed` flag for project snapshot persistence and explain that visual-only saves must not mark Terraform or setup PDFs as outdated.

### Task 7: End-to-end verification

**Files:**
- Test: `backend/tests/test_projects_endpoint.py`
- Test: `backend/tests/test_project_store.py`
- Test: `frontend/lib/__tests__/terraformGenerationObservability.test.ts`
- Test: `frontend/lib/__tests__/generationObservability.test.ts`
- Test: `frontend/lib/__tests__/projectApi.test.ts`
- Test: `frontend/lib/__tests__/terraformOutdatedState.test.ts`

- [ ] **Step 1: Run focused backend verification**
Run: `uv run pytest backend/tests/test_projects_endpoint.py backend/tests/test_project_store.py -q`

- [ ] **Step 2: Run focused frontend verification**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/terraformGenerationObservability.test.ts lib/__tests__/generationObservability.test.ts lib/__tests__/projectApi.test.ts lib/__tests__/terraformOutdatedState.test.ts`

- [ ] **Step 3: Run broader regressions around generation and snapshots**
Run: `uv run pytest backend/tests/test_ws_handler.py backend/tests/test_generation_observability.py backend/tests/test_projects_endpoint.py backend/tests/test_project_store.py -q`
Run: `pnpm --dir frontend exec vitest run lib/__tests__/generationObservability.test.ts lib/__tests__/generationSnapshotHydration.test.ts lib/__tests__/projectApi.test.ts lib/__tests__/terraformGenerationObservability.test.ts`

- [ ] **Step 4: Perform manual product verification**
Verify this exact sequence:
1. Start with a project that already has completed `Requirements`, `Architect`, and `Cost analysis` rows.
2. Click `Generate Terraform` and confirm the right panel opens to `generation`, not `output`.
3. Confirm the panel shows the three completed architecture rows plus a live `Coder` row underneath without a dependency line.
4. Confirm the `Coder` row turns green on success and shows `Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.`.
5. Confirm the output panel opens only after clicking `SEE TERRAFORM CODE` in the topbar.
6. Click `Auto Layout` without making structural changes and confirm the Terraform outdated banner does not appear.
7. Apply a real structural change through an approved chat mutation and confirm the Terraform outdated banner does appear.
