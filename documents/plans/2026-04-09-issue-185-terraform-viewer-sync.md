# Terraform Viewer Accuracy Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Terraform code panel always show the same content that copy and download use.

**Architecture:** Keep `terraformFiles` as the source of truth and make highlighted output depend on both filename and content. Extract the Terraform viewer state and cache management into focused helpers so the render path stays small and testable.

**Tech Stack:** Next.js 14, React 18, TypeScript, Shiki, Vitest

---

### Task 1: Persist the regression in tests

**Files:**
- Create: `frontend/components/terraformViewerHighlightCache.ts`
- Create: `frontend/components/terraformViewerHighlightCache.test.ts`

- [ ] **Step 1: Write the failing test**
Describe the stale render scenario where `main.tf` keeps the same filename but receives new content.

- [ ] **Step 2: Run the test to verify it fails**
Run: `pnpm exec vitest run components/terraformViewerHighlightCache.test.ts`
Expected: cache helpers preserve stale highlighted output for same-name files.

### Task 2: Fix stale highlighted output

**Files:**
- Modify: `frontend/components/TerraformViewer.tsx`
- Create: `frontend/components/useTerraformViewer.ts`
- Modify: `frontend/components/terraformViewerHighlightCache.ts`

- [ ] **Step 1: Invalidate cached highlight entries when file content changes**
Only reuse highlighted HTML when both filename and content still match.

- [ ] **Step 2: Re-run highlighting for changed files**
Allow a regenerated file with the same filename to be highlighted again.

- [ ] **Step 3: Keep copy and download behavior aligned with the same file source**
Make the render path consume the same up-to-date file object as copy/download.

### Task 3: Keep the viewer within frontend rules

**Files:**
- Modify: `frontend/components/TerraformViewer.tsx`
- Create: `frontend/components/useTerraformViewer.ts`

- [ ] **Step 1: Move state, effects, and handlers into a co-located hook**
Keep the component focused on rendering.

- [ ] **Step 2: Keep the component under 150 lines**
Preserve existing UI while reducing file size and complexity.

### Task 4: Verify the change

**Files:**
- Test: `frontend/components/terraformViewerHighlightCache.test.ts`

- [ ] **Step 1: Run the targeted regression test**
Run: `pnpm exec vitest run components/terraformViewerHighlightCache.test.ts`

- [ ] **Step 2: Run broader frontend verification**
Run: `pnpm exec vitest run`
Run: `pnpm lint`

- [ ] **Step 3: Confirm residual baseline status**
Note the pre-existing unrelated `templates.test.ts` failure separately if it still remains.
