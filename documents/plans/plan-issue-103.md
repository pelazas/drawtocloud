# Issue 103: "Describe Your App" Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "Describe your app" button behavior (which creates a new discovery project) with a modal that collects app details and triggers the architect agent on the current canvas.

**Architecture:** New `DescribeAppModal/` component with a `useDescribeAppModal` hook for state. The modal collects description, expected users, uptime, regions, and budget. On submit, it calls a new `startGenerationFromAnswers(answers)` method on the pipeline that runs `startGenerationViaHttp` against the active project. No new project is created.

**Tech Stack:** Next.js 14, React, Tailwind CSS, existing WS infrastructure

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/components/DescribeAppModal/useDescribeAppModal.ts` | Create | Modal open/close state, form field state, validation, submit handler |
| `frontend/components/DescribeAppModal/index.tsx` | Create | Modal UI: backdrop, form fields, submit/cancel buttons |
| `frontend/lib/useCanvasPipeline.ts` | Modify (~1209-1263, ~1364-1401) | Add `startGenerationFromAnswers(answers)` method exposed in return |
| `frontend/app/page.tsx` | Modify (~37-39, ~114-126) | Import modal, replace `handleDescribeApp` to open modal, render modal |

---

### Task 1: Add `startGenerationFromAnswers` to pipeline

**Files:**
- Modify: `frontend/lib/useCanvasPipeline.ts:1209-1263` (near `triggerGeneration`)

- [ ] **Step 1: Add the new function**

Add `startGenerationFromAnswers` after `triggerGeneration` (~line 1263). This function accepts `answers: QuestionnaireAnswers`, resolves the current project ID, and calls `startGenerationViaHttp`. It reuses the same state-setting pattern as `triggerGeneration`:

```typescript
async function startGenerationFromAnswers(answers: QuestionnaireAnswers) {
  const projectId =
    canvasSession?.mode === "existing"
      ? canvasSession.project.id
      : canvasSession?.mode === "new" || canvasSession?.mode === "chat_first"
        ? canvasSession.projectId ?? discoveryProjectId ?? undefined
        : undefined;

  if (!projectId) return;

  setIsGenerating(true);
  setPipelineStatus("Starting generation...");
  setCurrentStage("start");
  setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
  generationStartRef.current = Date.now();
  setLastEventAt(Date.now());
  setTerraformProgress({
    status: "planning",
    activity: "Planning Terraform files",
    emittedCount: 0,
    expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
    currentFile: null,
    lastUpdateAt: Date.now(),
  });

  try {
    const result = await startGenerationViaHttp(answers, projectId);
    setTraceId(result.trace_id);
    setPipelineStatus("Generation queued...");
    setCurrentStage("queued");
    if (result.project_id) {
      if (wsState === "open") {
        await subscribeProject(result.project_id);
      } else {
        wsClient.onOpen(() => {
          void subscribeProject(result.project_id);
        });
      }
    }
    onProjectReady?.(result.project_id, result.share_slug);
  } catch (error) {
    setIsGenerating(false);
    setPipelineStatus(`Error: ${(error as Error).message}`);
  }
}
```

- [ ] **Step 2: Export it in the return object**

Add `startGenerationFromAnswers` to the return object (~line 1397, after `triggerGeneration`):

```typescript
triggerGeneration,
startGenerationFromAnswers,
isDiscoveryMode,
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/useCanvasPipeline.ts
git commit -m "feat(pipeline): add startGenerationFromAnswers for describe modal"
```

---

### Task 2: Create `useDescribeAppModal` hook

**Files:**
- Create: `frontend/components/DescribeAppModal/useDescribeAppModal.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useCallback, useState } from "react";

export type DescribeFormAnswers = {
  description: string;
  expected_users: string;
  uptime: string;
  regions: string[];
  monthly_budget: number;
};

const DEFAULTS: DescribeFormAnswers = {
  description: "",
  expected_users: "",
  uptime: "",
  regions: [],
  monthly_budget: 0,
};

export function useDescribeAppModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<DescribeFormAnswers>({ ...DEFAULTS });

  const open = useCallback(() => {
    setForm({ ...DEFAULTS });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setField = useCallback(
    <K extends keyof DescribeFormAnswers>(key: K, value: DescribeFormAnswers[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const canSubmit = form.description.trim().length > 0;

  return { isOpen, form, open, close, setField, canSubmit };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/DescribeAppModal/useDescribeAppModal.ts
git commit -m "feat: add useDescribeAppModal hook"
```

---

### Task 3: Create `DescribeAppModal` component

**Files:**
- Create: `frontend/components/DescribeAppModal/index.tsx`

**Design tokens (from styleguide.md):**
- Backdrop: `bg-black/50 backdrop-blur-sm`
- Panel: `bg-gray-900 border border-gray-700 rounded-2xl`
- Inputs: `bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-blue-500`
- Option cards: `bg-[rgb(15_15_20)] border border-[rgb(40_40_50)]` resting, `bg-[rgb(14_24_45)] border-blue-500` selected
- Primary button: `bg-blue-600 hover:bg-blue-500 rounded-xl`
- Close button: `text-gray-400 hover:text-white`

- [ ] **Step 1: Create the modal component**

The modal should contain:
1. Header with title "Describe your app" + close X button
2. Description textarea (required)
3. Expected users card selector (1-100, 100-1K, 1K-10K, 10K-100K, 100K+)
4. Uptime card selector (Best effort, 99%, 99.9%, 99.99%)
5. Region multi-select buttons (us-east-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1)
6. Monthly budget number input
7. "Generate Architecture" primary submit button + "Cancel" secondary button

Keep the component under 150 lines. Use the `useDescribeAppModal` hook's `form` and `setField` props.

```typescript
"use client";

import { Sparkles, X } from "lucide-react";
import type { useDescribeAppModal } from "./useDescribeAppModal";

type Props = ReturnType<typeof useDescribeAppModal> & {
  onSubmit: (answers: Record<string, string | string[] | number>) => void;
};

const EXPECTED_USERS = ["1-100", "100-1K", "1K-10K", "10K-100K", "100K+"];
const UPTIME_OPTIONS = ["Best effort", "99%", "99.9%", "99.99%"];
const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"];

export default function DescribeAppModal({ isOpen, form, close, setField, canSubmit, onSubmit }: Props) {
  if (!isOpen) return null;

  function handleSubmit() {
    const answers: Record<string, string | string[] | number> = {
      description: form.description.trim(),
    };
    if (form.expected_users) answers.expected_users = form.expected_users;
    if (form.uptime) answers.uptime = form.uptime;
    if (form.regions.length > 0) answers.regions = form.regions;
    if (form.monthly_budget > 0) answers.monthly_budget = form.monthly_budget;
    onSubmit(answers);
    close();
  }

  const cardBase =
    "rounded-lg border px-3 py-2 text-sm transition-colors cursor-pointer";
  const cardResting =
    "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] text-gray-300 hover:border-[rgb(70_70_90)]";
  const cardSelected =
    "bg-[rgb(14_24_45)] border-blue-500 text-blue-200";

  function toggleRegion(region: string) {
    setField(
      "regions",
      form.regions.includes(region)
        ? form.regions.filter((r) => r !== region)
        : [...form.regions, region]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Describe your app</h2>
          </div>
          <button type="button" onClick={close} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">What are you building?</label>
            <textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Describe your application, its purpose, and key requirements..."
              rows={3}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>

          {/* Expected Users */}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Expected users</label>
            <div className="flex flex-wrap gap-2">
              {EXPECTED_USERS.map((opt) => (
                <button key={opt} type="button" onClick={() => setField("expected_users", form.expected_users === opt ? "" : opt)}
                  className={`${cardBase} ${form.expected_users === opt ? cardSelected : cardResting}`}>{opt}</button>
              ))}
            </div>
          </div>

          {/* Uptime */}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Uptime requirement</label>
            <div className="flex flex-wrap gap-2">
              {UPTIME_OPTIONS.map((opt) => (
                <button key={opt} type="button" onClick={() => setField("uptime", form.uptime === opt ? "" : opt)}
                  className={`${cardBase} ${form.uptime === opt ? cardSelected : cardResting}`}>{opt}</button>
              ))}
            </div>
          </div>

          {/* Regions */}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">AWS Regions</label>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((r) => (
                <button key={r} type="button" onClick={() => toggleRegion(r)}
                  className={`${cardBase} ${form.regions.includes(r) ? cardSelected : cardResting}`}>{r}</button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Monthly budget (USD)</label>
            <input
              type="number"
              value={form.monthly_budget || ""}
              onChange={(e) => setField("monthly_budget", Number(e.target.value) || 0)}
              placeholder="e.g. 500"
              min={0}
              className="w-full max-w-[200px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={close}
            className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Sparkles size={14} />
            Generate Architecture
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/DescribeAppModal/
git commit -m "feat: add DescribeAppModal component"
```

---

### Task 4: Wire modal into page.tsx

**Files:**
- Modify: `frontend/app/page.tsx:1-210`

- [ ] **Step 1: Import modal and hook**

Add imports at top of `page.tsx`:

```typescript
import DescribeAppModal from "@/components/DescribeAppModal";
import { useDescribeAppModal } from "@/components/DescribeAppModal/useDescribeAppModal";
```

- [ ] **Step 2: Initialize hook in WorkspaceContent**

After `const pipeline = workspace.pipeline;` (~line 17), add:

```typescript
const describeModal = useDescribeAppModal();
```

- [ ] **Step 3: Replace handleDescribeApp**

Replace the `handleDescribeApp` function (~line 37-39) with:

```typescript
function handleDescribeApp() {
  if (!workspace.requireAuth()) return;
  describeModal.open();
}
```

- [ ] **Step 4: Add submit handler**

Add after `handleDescribeApp`:

```typescript
function handleDescribeSubmit(answers: Record<string, string | string[] | number>) {
  void pipeline.startGenerationFromAnswers(answers);
}
```

- [ ] **Step 5: Render the modal**

Inside the return, right after the opening `<div className="flex flex-col h-screen bg-[#02040c]">` (~line 115), add:

```tsx
<DescribeAppModal {...describeModal} onSubmit={handleDescribeSubmit} />
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: wire DescribeAppModal into workspace page"
```

---

### Task 5: Handle edge case — no current project

When there's no current project yet (user just landed, no `?project=` param), the modal submit should first create a project, then trigger generation.

**Files:**
- Modify: `frontend/app/page.tsx` (handleDescribeSubmit)
- Modify: `frontend/lib/useWorkspace.ts` (add `startWithDescription`)

- [ ] **Step 1: Add `startWithDescription` to useWorkspace**

In `useWorkspace.ts`, after `startFromScratch` (~line 162), add:

```typescript
const startWithDescription = useCallback(
  async (answers: Record<string, string | string[] | number>) => {
    if (!requireAuth()) return;

    setCreatingProject(true);
    try {
      const result = await startGenerationViaHttp(answers);
      router.replace(resolveProjectRedirectPath(result.share_slug));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start generation");
    } finally {
      setCreatingProject(false);
    }
  },
  [requireAuth, router]
);
```

Add `startGenerationViaHttp` to the imports from `@/lib/generationStart`:

```typescript
import { resolveProjectRedirectPath, startDiscoverySession, startGenerationViaHttp } from "@/lib/generationStart";
```

Add `startWithDescription` to the return object.

- [ ] **Step 2: Update handleDescribeSubmit in page.tsx**

```typescript
function handleDescribeSubmit(answers: Record<string, string | string[] | number>) {
  if (workspace.currentProject) {
    void pipeline.startGenerationFromAnswers(answers);
  } else {
    void workspace.startWithDescription(answers);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/useWorkspace.ts frontend/app/page.tsx
git commit -m "feat: handle describe modal submit when no project exists"
```

---

### Task 6: Final cleanup and verification

- [ ] **Step 1: Run linter**

Run: `cd frontend && pnpm lint`
Expected: No errors

- [ ] **Step 2: Run type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify component line counts**

Check that `DescribeAppModal/index.tsx` is under 150 lines:
Run: `wc -l frontend/components/DescribeAppModal/index.tsx`
Expected: Under 150

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: lint fixes for describe modal"
```
