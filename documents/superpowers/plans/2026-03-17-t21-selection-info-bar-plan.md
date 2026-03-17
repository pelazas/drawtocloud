# T21 Selection Info Bar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove trash icon from selection info bar while preserving count text and keyboard delete behavior.

**Architecture:** Thin UI change: drop delete button and prop wiring from SelectionInfoBar; keep React Flow deleteKeyCode handling unchanged.

**Tech Stack:** Next.js 14, React, React Flow, Tailwind CSS, pnpm

---

### Task 1: Update SelectionInfoBar to remove delete button

**Files:**
- Modify: `frontend/components/Canvas/SelectionInfoBar.tsx`

- [ ] Remove `onDelete` prop from component interface and usage.
- [ ] Delete button markup/SVG; keep container and count text styling; adjust spacing if needed.

### Task 2: Update Canvas to match new props

**Files:**
- Modify: `frontend/components/Canvas.tsx`

- [ ] Update `SelectionInfoBar` usage to pass only count; clean up unused handler if possible.

### Task 3: Verification

**Files:**
- N/A

- [ ] Run `cd frontend && pnpm lint` to ensure type/lint health.
- [ ] Manual check (described in spec) if possible.
- [ ] Commit changes with message `chore: remove selection trash icon`.
