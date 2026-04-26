# Fix: Template 'Load' does not create a new project (Issue #236)

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development and superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `handleUseTemplate` function so that clicking **Load** on a template creates a new project by cloning the template server-side, then redirects to the newly created project.

**Architecture:** Replace the local-only `fetchTemplateDetail` + `loadTemplateSnapshot` flow in `handleUseTemplate` with a single `cloneTemplate` API call that creates a persisted project on the backend, followed by a client-side redirect to the new project's URL.

**Tech Stack:** Next.js 14 (frontend), Vitest (testing), React hooks

---

## Problem Summary

`handleUseTemplate` in `frontend/app/usePageState.ts` currently:
1. Calls `fetchTemplateDetail(slug)` (GET `/api/templates/{slug}`)
2. Calls `pipeline.loadTemplateSnapshot(template)` to hydrate local React Flow state
3. Does **not** create a new project or redirect

The backend already supports cloning via `POST /api/templates/{slug}/clone`, and the frontend already has a `cloneTemplate()` helper in `frontend/lib/templates.ts`. The fix is to wire them together.

---

## Files to Modify

- `frontend/app/usePageState.ts` — change `handleUseTemplate` implementation
- `frontend/app/__tests__/usePageState.test.ts` — add test for new cloning behavior

---

## Task 1: Add failing test for `handleUseTemplate` cloning behavior

**Files:**
- Modify: `frontend/app/__tests__/usePageState.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that asserts:
- `handleUseTemplate` calls `cloneTemplate` (not `fetchTemplateDetail`)
- On success, it calls `workspace.openProject` with the returned `share_slug`
- It does **not** call `pipeline.loadTemplateSnapshot`

```typescript
it("clones template and redirects to new project when user clicks Load", async () => {
  // ... test body
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run app/__tests__/usePageState.test.ts`
Expected: FAIL — `cloneTemplate` is not imported or called

---

## Task 2: Implement the fix in `handleUseTemplate`

**Files:**
- Modify: `frontend/app/usePageState.ts`

- [ ] **Step 3: Replace `fetchTemplateDetail` with `cloneTemplate`**

Changes in `frontend/app/usePageState.ts`:
1. Change the import from `fetchTemplateDetail` to `cloneTemplate`
2. Update `handleUseTemplate` to call `cloneTemplate(slug)`
3. On success, call `workspace.openProject(response.share_slug)` instead of `pipeline.loadTemplateSnapshot(template)`
4. Keep the confirmation dialog for non-empty canvas
5. Keep error handling with `toast.error`

```typescript
import { cloneTemplate } from "@/lib/templates";

async function handleUseTemplate(slug: string) {
  if (interactionsLocked) return;
  if (pipeline.nodes.length > 0) {
    const shouldReplace = window.confirm(
      "Discard current design? Loading this template will replace your current canvas."
    );
    if (!shouldReplace) return;
  }
  try {
    const response = await cloneTemplate(slug);
    workspace.openProject(response.share_slug);
    toast.success("Template cloned successfully");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to clone template");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run app/__tests__/usePageState.test.ts`
Expected: PASS

---

## Task 3: Verify no regressions

- [ ] **Step 5: Run all frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit the fix**

```bash
git add frontend/app/usePageState.ts frontend/app/__tests__/usePageState.test.ts
git commit -m "fix: template Load now clones project server-side instead of overwriting canvas

Fixes #236
- Replace fetchTemplateDetail + loadTemplateSnapshot with cloneTemplate
- Redirect to newly created project after successful clone
- Update test to assert cloning behavior instead of local snapshot load"
```

---

## Acceptance Criteria

- [ ] `handleUseTemplate` calls `cloneTemplate` and redirects on success
- [ ] `handleUseTemplate` no longer calls `fetchTemplateDetail` or `loadTemplateSnapshot`
- [ ] Test verifies cloning + redirect behavior
- [ ] All existing tests still pass
