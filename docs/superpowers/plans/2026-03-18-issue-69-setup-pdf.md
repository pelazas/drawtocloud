# Setup PDF Guide (Issue #69) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level setup PDF generation/download flow with deterministic progress, stale detection, retry, and signed download access.

**Architecture:** Add backend setup-PDF generation service plus authenticated HTTP endpoints and project-scoped websocket progress events. Persist setup-PDF metadata on `projects`, then expose state to frontend pipeline and render right-panel bottom actions (`Generate`, progress bar, `Download`, `Regenerate`, `Retry`).

**Tech Stack:** FastAPI, Supabase Storage, Pillow PDF rendering, Next.js/React, existing websocket project channel.

---

## Chunk 1: Backend Data + Service

### Task 1: Add setup PDF columns (migration)

**Files:**
- Create: `supabase/migrations/010_setup_pdf_metadata.sql`

- [ ] **Step 1: Write migration for setup PDF metadata fields**
- [ ] **Step 2: Include indexes where useful (`setup_pdf_status`)**

### Task 2: Add setup PDF generation service

**Files:**
- Create: `backend/setup_pdf_service.py`
- Modify: `backend/generation_service.py`

- [ ] **Step 1: Add failing tests for endpoint/service integration stubs**
- [ ] **Step 2: Implement service APIs**
  - `start_setup_pdf_generation_for_user(user_id, project_id)`
  - `create_setup_pdf_download_url_for_user(user_id, project_id)`
- [ ] **Step 3: Implement deterministic milestone updates (10/25/55/85/100)**
- [ ] **Step 4: Reuse project broadcaster for websocket events (`setup_pdf_status`)**
- [ ] **Step 5: Ensure idempotent generate calls while task is running**

### Task 3: Add PDF rendering utility

**Files:**
- Create: `backend/setup_pdf_generator.py`

- [ ] **Step 1: Build generic section content (purpose, prereqs, install, AWS setup, deploy, management, troubleshooting)**
- [ ] **Step 2: Build project-specific section content (project overview, timestamp, commands, resource checklist)**
- [ ] **Step 3: Render PDF bytes with Pillow and include architecture snapshot image when available**

## Chunk 2: Backend API + Project Data

### Task 4: Add HTTP endpoints

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add `POST /api/projects/{project_id}/setup-pdf/generate`**
- [ ] **Step 2: Add `GET /api/projects/{project_id}/setup-pdf/download`**
- [ ] **Step 3: Add request/response models, auth checks, and error mapping**

### Task 5: Extend project row contracts

**Files:**
- Modify: `backend/project_store.py`
- Modify: `backend/ws_handler.py`

- [ ] **Step 1: Include setup-PDF fields in project select statements and snapshots**
- [ ] **Step 2: Mark existing ready PDFs as outdated when architecture state changes (`canvas_edit`, mutation reruns, full regeneration for existing projects)**

## Chunk 3: Frontend State + UI

### Task 6: Add frontend setup PDF API helpers

**Files:**
- Create: `frontend/lib/setupPdf.ts`

- [ ] **Step 1: Write helpers for generate/download using auth token and backend APIs**

### Task 7: Thread setup PDF state through project mapping and pipeline

**Files:**
- Modify: `frontend/lib/projects.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`

- [ ] **Step 1: Add setup-PDF fields to `PersistedProject` and row parser**
- [ ] **Step 2: Track setup-PDF state in pipeline hook**
- [ ] **Step 3: Handle `setup_pdf_status` websocket events and expose actions/state to UI**

### Task 8: Add right-panel bottom actions UI

**Files:**
- Create: `frontend/components/SetupPdfActions.tsx`
- Modify: `frontend/components/OutputPanel.tsx`
- Modify: `frontend/app/p/[slug]/project-by-slug-client.tsx`
- Modify: `frontend/app/new/discovery/page.tsx`
- Modify: `frontend/app/new/discovery/useDiscoveryPage.ts`

- [ ] **Step 1: Render full-width bottom action area in right panel**
- [ ] **Step 2: Support states**
  - `Generate setup PDF` (disabled until generation completed)
  - `Generating...` + 0–100 progress bar
  - `Download setup PDF`
  - `PDF outdated` + `Regenerate`
  - `Retry` on failure with clear message
- [ ] **Step 3: Hide controls in read-only shared views**

## Chunk 4: Tests + Docs + Verification

### Task 9: Add/adjust backend tests

**Files:**
- Create: `backend/tests/test_setup_pdf_endpoints.py`
- Modify: `backend/tests/test_ws_handler.py`

- [ ] **Step 1: RED tests for auth + endpoint behavior + domain error mapping**
- [ ] **Step 2: GREEN implementation adjustments until passing**

### Task 10: Update documentation contracts

**Files:**
- Modify: `documents/data-reference.md`
- Modify: `documents/platform-docs.md`

- [ ] **Step 1: Document new project metadata fields**
- [ ] **Step 2: Document new HTTP endpoints and websocket event shape**
- [ ] **Step 3: Document right-panel setup PDF UX states**

### Task 11: Verify end-to-end

- [ ] **Step 1: Run backend tests (targeted + full relevant suite)**
- [ ] **Step 2: Run frontend lint/type checks for touched code**
- [ ] **Step 3: Validate no regressions in generation/chat flow via existing tests**
