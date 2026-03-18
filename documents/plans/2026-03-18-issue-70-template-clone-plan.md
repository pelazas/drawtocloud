# Issue #70 Template Clone Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a “Start from template” flow on dashboard New Generation, including template listing, authenticated cloning, quota-aware gating, and redirect to a fully populated project.

**Architecture:** Add a database flag (`is_template`) to mark template projects. Expose backend endpoints to list templates and clone one into a user-owned completed project while enforcing auth and quota behavior. On frontend, replace direct new-generation navigation with a modal that offers Custom vs Template and handles clone+redirect UX.

**Tech Stack:** Supabase SQL migrations, FastAPI (Python 3.12), Next.js 14 + Tailwind + Radix Dialog, pytest, vitest.

---

### Task 1: DB + Backend template API surface

**Files:**
- Create: `supabase/migrations/010_project_templates.sql`
- Modify: `backend/project_store.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_templates_endpoint.py`

- [ ] Step 1: Write failing backend tests for GET templates and clone auth/error/success paths.
- [ ] Step 2: Run `cd backend && uv run pytest tests/test_templates_endpoint.py -q` and confirm failures.
- [ ] Step 3: Implement migration + project_store helpers + FastAPI endpoints with response models.
- [ ] Step 4: Re-run `cd backend && uv run pytest tests/test_templates_endpoint.py -q` and confirm pass.

### Task 2: Frontend template client helpers

**Files:**
- Create: `frontend/lib/templates.ts`
- Test: `frontend/lib/__tests__/templates.test.ts`

- [ ] Step 1: Write failing vitest tests for response parsing and request payload handling.
- [ ] Step 2: Run `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts` and confirm failures.
- [ ] Step 3: Implement template list + clone helpers using existing auth token pattern.
- [ ] Step 4: Re-run `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts` and confirm pass.

### Task 3: Dashboard modal + quota/button behavior

**Files:**
- Create: `frontend/components/ProjectsDashboard/NewGenerationDialog.tsx`
- Modify: `frontend/components/ProjectsDashboard/index.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] Step 1: Add component-level logic and state wiring to open modal from New Generation.
- [ ] Step 2: Implement Custom path (`/new`) and Template path (fetch cards, clone, loading, redirect).
- [ ] Step 3: Apply quota gate on button: disable for non-admin/no-BYOK when quota is 0, show “No remaining quota”.
- [ ] Step 4: Run `cd frontend && pnpm lint` to verify TS/ESLint correctness.

### Task 4: Documentation and verification

**Files:**
- Modify: `documents/platform-docs.md`
- Modify: `documents/data-reference.md`

- [ ] Step 1: Document new endpoints and template data behavior.
- [ ] Step 2: Run focused backend/frontend tests plus lint:
  - `cd backend && uv run pytest tests/test_templates_endpoint.py tests/test_project_store.py -q`
  - `cd frontend && pnpm exec vitest run lib/__tests__/templates.test.ts`
  - `cd frontend && pnpm lint`
- [ ] Step 3: Run quick git diff sanity check.
