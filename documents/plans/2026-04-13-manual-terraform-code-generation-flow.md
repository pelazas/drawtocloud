# Manual Terraform Code Generation Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual Terraform generation run only the coder flow from the current canvas state, show accurate code-generation progress in the UI, and expose the generated Terraform immediately after completion.

**Architecture:** Split manual Terraform generation from the initial architecture pipeline at the rerun orchestrator layer. Introduce a dedicated code-generation observability mode for the backend/frontend contract, then update the workspace UI to distinguish architecture generation from coder-only runs while reusing the existing output panel and Terraform file stream.

**Tech Stack:** FastAPI, Python 3.12, Next.js 14, React 18, TypeScript, WebSockets, pytest, Vitest

---

### Task 1: Lock the backend bug down with rerun tests

**Files:**
- Modify: `backend/tests/test_ws_handler.py`
- Modify: `backend/tests/test_generation_observability.py`
- Create or Modify: `backend/tests/test_generation_service.py`

- [ ] **Step 1: Write a failing websocket-level test for manual Terraform generation**
Assert that a `generate_terraform` request queues a coder-only rerun and does not surface requirements-stage progress or requirements-agent startup.

- [ ] **Step 2: Write a failing service-level test for coder-only reruns**
Assert that rerunning with `agent_names=["coder"]` does not call requirements generation and instead invokes Terraform streaming with persisted questionnaire answers plus current diagram nodes.

- [ ] **Step 3: Write a failing observability test for code generation mode**
Assert that the backend emits a code-generation-specific observability payload instead of the initial `requirements -> architect -> cost_analyst` chain.

- [ ] **Step 4: Run the targeted backend tests to confirm failure**
Run: `uv run pytest backend/tests/test_ws_handler.py backend/tests/test_generation_service.py backend/tests/test_generation_observability.py -q`
Expected: failures showing that coder-only generation still enters the requirements path and/or emits the wrong observability mode.

### Task 2: Separate coder-only reruns from requirements reruns

**Files:**
- Modify: `backend/generation_service.py`

- [ ] **Step 1: Split rerun orchestration by run type**
Introduce an explicit coder-only rerun branch so `generate_terraform` no longer shares the `rerun_requirements` path.

- [ ] **Step 2: Build coder inputs from persisted project context**
Use stored questionnaire answers and current diagram nodes/edges as the coder inputs without regenerating requirements.

- [ ] **Step 3: Preserve existing rerun behavior for other rerun types**
Keep the existing requirements-backed rerun flow for paths that actually need requirements regeneration.

- [ ] **Step 4: Re-run the targeted backend tests**
Run: `uv run pytest backend/tests/test_ws_handler.py backend/tests/test_generation_service.py backend/tests/test_generation_observability.py -q`
Expected: coder-only rerun tests pass and non-coder rerun behavior remains covered.

### Task 3: Add dedicated code-generation observability contracts

**Files:**
- Modify: `backend/generation_service.py`
- Modify: `frontend/lib/generationObservability.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`
- Modify: `frontend/lib/__tests__/generationObservability.test.ts`

- [ ] **Step 1: Define a code-generation observability mode in the backend**
Emit `generation_agent_update` and `generation_agent_event` payloads that describe a coder-focused run instead of the architecture-generation chain.

- [ ] **Step 2: Track coder milestones through public progress states**
Broadcast queued, running, per-file progress, completed, and failed states using stable message fields that the frontend can consume after reconnects.

- [ ] **Step 3: Make the frontend parser mode-aware**
Preserve support for initial generation while accepting the new code-generation mode and its agent list.

- [ ] **Step 4: Run the targeted frontend observability tests**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/generationObservability.test.ts`
Expected: the new mode parses successfully and existing initial-generation parsing still passes.

### Task 4: Fix workspace status text and right-panel routing

**Files:**
- Modify: `frontend/lib/generationUiState.ts`
- Modify: `frontend/app/usePageState.ts`
- Modify: `frontend/lib/useWorkspace.ts`
- Modify: `frontend/components/RightPanel.tsx`
- Modify: `frontend/components/GenerationObservabilityPanel.tsx`
- Create if needed: `frontend/components/GenerationObservabilityPanel/CodeGenerationCard.tsx`
- Modify: `frontend/lib/__tests__/generationUiState.test.ts`

- [ ] **Step 1: Write a failing UI-state test for the bottom status bar**
Assert that manual Terraform generation shows coder-specific text before any generic architecture-generation label.

- [ ] **Step 2: Make status priority reflect the active run type**
Ensure coder generation wins over the generic `isGenerating` label so the bottom bar no longer says `Architect generating app` during Terraform generation.

- [ ] **Step 3: Stop treating manual Terraform generation as architecture generation in the right panel**
Keep the architecture-generation auto-open behavior scoped to initial generation, then support a dedicated `Code Generation` presentation when the user starts manual Terraform generation.

- [ ] **Step 4: Show file-by-file progress in the code-generation view**
Surface the current filename, emitted file count, and terminal success/failure state from existing Terraform stream data.

- [ ] **Step 5: Re-run targeted frontend tests**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/generationUiState.test.ts`
Expected: coder-specific status text is selected correctly.

### Task 5: Tighten Terraform button and output-panel behavior

**Files:**
- Modify: `frontend/components/TopBar.tsx`
- Modify: `frontend/components/TerraformViewer.tsx`
- Modify: `frontend/lib/useCanvasPipeline.ts`
- Modify: `frontend/lib/canvasInteractionGuards.ts`
- Modify: `frontend/lib/__tests__/canvasInteractionGuards.test.ts`

- [ ] **Step 1: Write a failing interaction test for the Terraform button lifecycle**
Assert the sequence `Generate Terraform -> generating -> See Terraform Code` as files stream in and the run completes.

- [ ] **Step 2: Keep the existing button states but tie them to coder progress accurately**
Ensure `See Terraform Code` appears when generated files are available and remains disabled only while code generation is active.

- [ ] **Step 3: Open or preserve access to the Terraform viewer on completion**
Make it easy to inspect generated code immediately after manual generation without losing the existing output panel behavior.

- [ ] **Step 4: Re-run targeted frontend interaction tests**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/canvasInteractionGuards.test.ts`
Expected: button-state assertions pass for empty, active, and completed code-generation states.

### Task 6: Update contracts and workflow documentation

**Files:**
- Modify: `documents/platform-docs.md`
- Modify: `documents/data-reference.md`
- Modify: `backend/CLAUDE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document manual Terraform generation as coder-only**
Clarify that `generate_terraform` uses the persisted/current diagram and does not re-enter requirements or architect.

- [ ] **Step 2: Document the code-generation observability mode**
Add the new message semantics and UI behavior for the `Code Generation` panel/card.

- [ ] **Step 3: Document the updated button/output behavior**
Describe when the user sees `Generate Terraform`, `See Terraform Code`, and file-by-file progress.

### Task 7: Full verification

**Files:**
- Test: `backend/tests/test_ws_handler.py`
- Test: `backend/tests/test_generation_service.py`
- Test: `backend/tests/test_generation_observability.py`
- Test: `frontend/lib/__tests__/generationObservability.test.ts`
- Test: `frontend/lib/__tests__/generationUiState.test.ts`
- Test: `frontend/lib/__tests__/canvasInteractionGuards.test.ts`

- [ ] **Step 1: Run focused backend verification**
Run: `uv run pytest backend/tests/test_ws_handler.py backend/tests/test_generation_service.py backend/tests/test_generation_observability.py -q`

- [ ] **Step 2: Run focused frontend verification**
Run: `pnpm --dir frontend exec vitest run lib/__tests__/generationObservability.test.ts lib/__tests__/generationUiState.test.ts lib/__tests__/canvasInteractionGuards.test.ts`

- [ ] **Step 3: Run broader regression checks**
Run: `uv run pytest backend/tests -q`
Run: `pnpm --dir frontend exec vitest run`

- [ ] **Step 4: Perform manual product verification**
Verify this sequence in the app:
`Generate Terraform` starts a code-generation panel, the bottom bar references coder progress, files stream with per-file updates, the button changes to `See Terraform Code`, and the Terraform viewer shows the generated files after completion.
