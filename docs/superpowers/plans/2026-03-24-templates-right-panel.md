# Templates Right Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move template browsing/loading into the right panel and load template content in-place on the canvas.

**Architecture:** Add a public backend endpoint for full template detail by slug, extend frontend template API utilities, and wire a new `templates` right-panel tab that fetches list/detail and applies detail through a dedicated canvas pipeline snapshot loader. Keep clone flow unchanged.

**Tech Stack:** FastAPI, Supabase Python client, Next.js 14, React, TypeScript, React Flow, Vitest, pytest

---

### Task 1: Backend template detail endpoint

**Files:**
- Modify: `backend/tests/test_templates_endpoint.py`
- Modify: `backend/project_store.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write failing endpoint tests**
Add tests for:
- success response from `GET /api/templates/{slug}`
- 404 `template_not_found` response

- [ ] **Step 2: Run backend template endpoint tests (expect fail)**
Run: `cd backend && uv run pytest tests/test_templates_endpoint.py -v`

- [ ] **Step 3: Implement store helper + endpoint**
Add project-store helper to fetch full template snapshot and expose `GET /api/templates/{slug}` in `main.py` with documented FastAPI metadata.

- [ ] **Step 4: Re-run backend tests (expect pass)**
Run: `cd backend && uv run pytest tests/test_templates_endpoint.py -v`

---

### Task 2: Frontend template detail API client

**Files:**
- Modify: `frontend/lib/__tests__/templates.test.ts`
- Modify: `frontend/lib/templates.ts`

- [ ] **Step 1: Write failing parser tests**
Add tests for template detail payload parsing validity and invalid payload rejection.

- [ ] **Step 2: Run frontend template tests (expect fail)**
Run: `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts`

- [ ] **Step 3: Implement detail types/parser/fetcher**
Add `TemplateDetail`, `parseTemplateDetailResponse`, and `fetchTemplateDetail(slug)`.

- [ ] **Step 4: Re-run frontend template tests (expect pass)**
Run: `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts`

---

### Task 3: Right panel templates UI + in-place load orchestration

**Files:**
- Modify: `frontend/lib/useWorkspace.ts`
- Modify: `frontend/lib/useCanvasPipeline.ts`
- Create: `frontend/components/RightPanel/TemplateCard.tsx`
- Create: `frontend/components/RightPanel/TemplatesPanel.tsx`
- Modify: `frontend/components/RightPanel.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Add workspace/pipeline extension points**
- `RightPanelTab` includes `templates`
- add `openTemplates()` in workspace hook
- add `loadTemplateSnapshot(data)` in canvas pipeline

- [ ] **Step 2: Add templates panel components**
Render list/error/empty/loading states and per-card “Use” action.

- [ ] **Step 3: Wire right panel and page handlers**
- TopBar templates button opens templates tab
- pass `onUseTemplate` into right panel
- `handleUseTemplate` confirms discard when needed, fetches detail, and applies snapshot

- [ ] **Step 4: Run focused frontend validation**
Run: `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts`

---

### Task 4: End-to-end verification commands

**Files:** none

- [ ] **Step 1: Backend test verification**
Run: `cd backend && uv run pytest tests/test_templates_endpoint.py -v`

- [ ] **Step 2: Frontend test verification**
Run: `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts`

- [ ] **Step 3: Final workspace check**
Run: `git status --short`
