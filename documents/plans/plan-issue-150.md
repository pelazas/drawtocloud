# Issue 150 Save Modal Rename Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Save button always open the naming modal (including existing owned projects), allow renaming on save, and persist title updates via a new backend endpoint.

**Architecture:** Move save behavior to a single modal-driven flow in `useSaveProject`: both new and existing owned projects go through the same modal submit path. Add a lightweight `PATCH /api/projects/{project_id}` endpoint to update `title`, and call it from frontend before snapshot save when the submitted name differs from the current title.

**Tech Stack:** Next.js 14 + React hooks + Vitest (frontend), FastAPI + pytest (backend), Supabase project store update helpers.

---

## Chunk 1: Frontend Save Intent + Modal Prefill

### Task 1: Switch existing-owned Save flow to modal-first

**Files:**
- Modify: `frontend/lib/useSaveProject.ts`
- Test: `frontend/lib/__tests__/useSaveProject.test.ts`

- [ ] **Step 1: RED — add failing tests for modal-first owned save intent**
  - Add helper-level tests asserting owned projects now route through modal intent instead of direct snapshot save.
  - Run: `cd frontend && pnpm exec vitest lib/__tests__/useSaveProject.test.ts -t "modal"`
  - Expected: FAIL on current behavior (`save-owned` path still bypasses modal).

- [ ] **Step 2: GREEN — update intent logic and click handling**
  - Keep `forbidden` behavior unchanged.
  - Change owned-project click path to set `showModal=true` and avoid direct `saveSnapshot` call in `handleSaveClick`.
  - Preserve existing in-flight save guard behavior.

- [ ] **Step 3: RED/GREEN — add prefill behavior contract**
  - Add/adjust exported helper(s) in `useSaveProject.ts` to derive modal default name from `currentProject.title`.
  - Cover trimming/empty fallback behavior in tests.

### Task 2: Prefill modal input and adapt copy for existing project save

**Files:**
- Modify: `frontend/components/SaveProjectModal.tsx`
- Modify: `frontend/app/page.tsx`
- Test: `frontend/lib/__tests__/useSaveProject.test.ts` (or new helper test if extraction is needed)

- [ ] **Step 1: RED — add failing test for default modal name handling**
  - If needed, extract a tiny pure helper for initial name normalization so it can be unit tested without DOM test libs.
  - Run: `cd frontend && pnpm exec vitest lib/__tests__/useSaveProject.test.ts`
  - Expected: FAIL until default name path is wired.

- [ ] **Step 2: GREEN — implement modal defaults**
  - Add optional `defaultName` prop to `SaveProjectModal`.
  - On open, initialize input from `defaultName` instead of always empty string.
  - Update modal subtitle to support both contexts:
    - New project: “Choose a name for your new project.”
    - Existing project: “Update your project name before saving.”

- [ ] **Step 3: Wire modal props from page/hook**
  - Pass current project title as `defaultName` when present.
  - Keep existing `Save` button label and disabled behavior.

## Chunk 2: Backend Rename Endpoint

### Task 3: Add authenticated project title update endpoint

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_projects_endpoint.py`

- [ ] **Step 1: RED — add failing API tests for rename endpoint**
  - Add tests for:
    - missing auth header -> `401 unauthenticated`
    - invalid token -> `401 invalid_token`
    - success -> `200 {"ok": true}` and correct `update_project_fields` call
    - store failure -> `400 {"error":"project_update_failed", ...}`
  - Run: `cd backend && uv run pytest tests/test_projects_endpoint.py -k "update_project or rename"`
  - Expected: FAIL because endpoint does not yet exist.

- [ ] **Step 2: GREEN — implement endpoint and request model**
  - Add `UpdateProjectRequest` model with optional `title: str | None`.
  - Add `PATCH /api/projects/{project_id}` endpoint with FastAPI docs metadata (`summary`, `description`, `tags=["projects"]`).
  - Normalize title (`strip`, max 120, fallback `"Untitled Project"` if blank) before calling:
    - `await update_project_fields(project_id, auth_user.user_id, {"title": normalized_title})`
  - Return `{"ok": True}`.

- [ ] **Step 3: keep behavior scoped**
  - Only title update is supported for this issue; reject empty payload with `400`.

## Chunk 3: Frontend Rename API + Save Orchestration

### Task 4: Add frontend API helper for project rename

**Files:**
- Modify: `frontend/lib/projectApi.ts`
- Test: `frontend/lib/__tests__/projectApi.test.ts`

- [ ] **Step 1: RED — add failing `renameProject` API tests**
  - Verify request method/path/body/headers:
    - `PATCH /api/projects/{project_id}`
    - body `{ "title": "<name>" }`
  - Verify error parsing and missing-token behavior mirrors existing helpers.
  - Run: `cd frontend && pnpm exec vitest lib/__tests__/projectApi.test.ts -t "renameProject"`
  - Expected: FAIL until helper exists.

- [ ] **Step 2: GREEN — implement `renameProject(projectId, title)`**
  - Reuse existing auth token and `parseErrorMessage`.
  - Throw backend detail errors consistently with current API helpers.

### Task 5: Rename existing project before snapshot save when title changed

**Files:**
- Modify: `frontend/lib/useSaveProject.ts`
- Test: `frontend/lib/__tests__/useSaveProject.test.ts`

- [ ] **Step 1: RED — add failing sequence tests**
  - For existing owned project + changed name:
    - `renameProject` called first
    - `saveSnapshot` called second
  - For unchanged name:
    - skip `renameProject`
    - still save snapshot
  - For rename failure:
    - snapshot not called
    - error toast surfaced

- [ ] **Step 2: GREEN — implement save orchestration**
  - Add helper path used by modal submit:
    - Existing project:
      - compare trimmed submitted name vs current title
      - rename first if changed
      - save snapshot
    - New project:
      - keep existing create + snapshot path
  - Keep modal open/close semantics:
    - close on success
    - remain open on failure so user can retry/edit

- [ ] **Step 3: verify call-site wiring**
  - Ensure modal `onSave` points to unified submit handler (not new-project-only behavior).

## Chunk 4: Documentation + Verification

### Task 6: Update API contract docs

**Files:**
- Modify: `documents/data-reference.md`
- Modify: `documents/platform-docs.md`

- [ ] **Step 1: Document new endpoint**
  - Add `PATCH /api/projects/{project_id}` request/response and auth requirement.
- [ ] **Step 2: Document issue-specific save behavior**
  - Note that Save opens naming modal for both new and existing owned projects.

### Task 7: End-to-end verification before claiming done

- [ ] **Step 1: Frontend targeted tests**
  - Run: `cd frontend && pnpm exec vitest lib/__tests__/useSaveProject.test.ts lib/__tests__/projectApi.test.ts`
  - Expected: PASS

- [ ] **Step 2: Backend targeted tests**
  - Run: `cd backend && uv run pytest tests/test_projects_endpoint.py`
  - Expected: PASS

- [ ] **Step 3: Optional broader regression spot-check**
  - Run: `cd frontend && pnpm lint`
  - Run: `cd backend && uv run pytest tests/test_project_store.py`
  - Expected: PASS (or document unrelated pre-existing failures).

