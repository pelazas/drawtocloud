# Project Deletion from Dashboard — Design Spec

**Issue:** #43
**Date:** 2026-03-17
**Status:** Approved

---

## Problem

The dashboard (`/`) shows project cards but provides no way to delete them. Users who accumulate old or test projects have no way to clean up their list.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Delete mechanism | Frontend-only Supabase client | `page.tsx` already reads projects via the Supabase browser client; RLS enforces ownership (`auth.uid() = user_id`) |
| Confirmation UI | Radix Dialog modal | `@radix-ui/react-dialog` is already installed; consistent with `ApiKeyModal` pattern |
| Success/error feedback | `sonner` toast | Lightweight, dark-UI friendly; install as new dependency |
| Component architecture | Hook + sub-components (Approach A) | `ProjectsDashboard.tsx` already exceeds 150-line limit; split is required by project rules |

---

## File Changes

| File | Action | Notes |
|---|---|---|
| `frontend/components/ProjectsDashboard/index.tsx` | Modify (rename from `.tsx` to folder) | Pure UI; delegates all logic to hook and props |
| `frontend/components/ProjectsDashboard/useProjectsDashboard.ts` | Create | Delete state, confirm/cancel/optimistic handlers |
| `frontend/components/ProjectsDashboard/DeleteProjectDialog.tsx` | Create | Radix Dialog confirmation modal |
| `frontend/lib/projects.ts` | Modify | Add `deleteProject(supabase, projectId)` helper |
| `frontend/app/page.tsx` | Modify | Wire delete handler; pass delete props |
| `frontend/app/layout.tsx` | Modify | Add `<Toaster />` from sonner |
| `frontend/package.json` | Modify | Add `sonner` dependency |

**No backend changes required.**

---

## Architecture

### `deleteProject` (projects.ts)

```ts
export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void>
```

Calls `supabase.from("projects").delete().eq("id", projectId)`. RLS on the Supabase side enforces that only the authenticated user's own rows are deleted. Throws on error.

---

### `useProjectsDashboard` hook

Lives at `frontend/components/ProjectsDashboard/useProjectsDashboard.ts`.

**Parameters:**
```ts
{
  projects: PersistedProject[]
  setProjects: Dispatch<SetStateAction<PersistedProject[]>>
}
```

The Supabase client is obtained inside the hook via `getSupabaseBrowserClient()` (same import used in `page.tsx`), not passed as a parameter. The `user` param is not needed — RLS enforces ownership and a null user would cause the Supabase call to fail, which is caught as an error.

**Internal state:**
```ts
pendingDeleteId: string | null       // id of the project awaiting confirmation
pendingDeleteIndex: number | null    // index in projects[] captured at handleDeleteClick time, for rollback
isDeleting: boolean                  // true while the async Supabase call is in flight
```

**Returns:**
```ts
{
  pendingDeleteId: string | null
  isDeleting: boolean
  handleDeleteClick: (id: string) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
}
```

**Delete flow:**

1. `handleDeleteClick(id)`:
   - No-op if `isDeleting` is `true` (guard against re-entrancy)
   - Records `pendingDeleteId = id` and `pendingDeleteIndex = projects.findIndex(p => p.id === id)`

2. `confirmDelete()`:
   a. Sets `isDeleting = true` atomically at the start (blocks any further calls)
   b. Snapshots the project at `pendingDeleteIndex` for possible rollback
   c. Optimistically removes project from `projects` state: `setProjects(prev => prev.filter(p => p.id !== pendingDeleteId))`
   d. Calls `deleteProject(supabase, pendingDeleteId)`
   e. **On success:** `toast.success("Project deleted")`, resets `pendingDeleteId = null`, `pendingDeleteIndex = null`, `isDeleting = false`
   f. **On error:** Re-inserts the snapshot at `pendingDeleteIndex` using `setProjects(prev => [...prev.slice(0, pendingDeleteIndex), snapshot, ...prev.slice(pendingDeleteIndex)])`, `toast.error("Failed to delete project")`, resets `isDeleting = false`, `pendingDeleteId = null`

   > **Note on concurrent state:** Concurrent deletes are not supported (blocked by `isDeleting` guard). Background refetches are not triggered by the dashboard while a delete is in flight, so insertion-index rollback is safe within normal usage.

3. `cancelDelete()`:
   - No-op if `isDeleting` is `true` (cancellation is not possible mid-flight; the operation will complete and the result reflected via toast)
   - Otherwise resets `pendingDeleteId = null`, `pendingDeleteIndex = null`

---

### `DeleteProjectDialog` component

```
frontend/components/ProjectsDashboard/DeleteProjectDialog.tsx
```

Props:
```ts
{
  open: boolean
  projectTitle: string
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}
```

UI:
- Radix `Dialog.Root` controlled by `open` prop
- Title: "Delete project?"
- Body: "**{projectTitle}** and all its data (diagram, Terraform files, cost estimate) will be permanently deleted. This cannot be undone."
- Buttons:
  - `Cancel` — disabled and visually muted when `isDeleting` is `true`
  - `Delete` — red/destructive; shows a spinner and is disabled when `isDeleting` is `true`
- `onOpenChange` on the Radix root calls `onCancel` — but `onCancel` is a no-op when `isDeleting` is `true` (see hook), so pressing Escape or clicking outside while a delete is in-flight simply does nothing

---

### `ProjectsDashboard/index.tsx`

Receives new props:
```ts
onDeleteProject: (id: string) => void
pendingDeleteId: string | null
isDeleting: boolean
onConfirmDelete: () => void
onCancelDelete: () => void
```

Each project card wraps its content in a `group` div. A `Trash2` icon button sits top-right of each card:
- `opacity-0 group-hover:opacity-100 transition-opacity`
- `onClick: (e) => { e.stopPropagation(); onDeleteProject(project.id) }`

`DeleteProjectDialog` is rendered once at the bottom of the component, controlled by `pendingDeleteId !== null`. It receives `projectTitle` resolved from the `projects` list via `pendingDeleteId`.

---

### `page.tsx` changes

1. Install `sonner`, import `<Toaster />` into `layout.tsx`
2. Use `useProjectsDashboard` hook, passing `projects` and `setProjects`
3. Pass delete props to `<ProjectsDashboard />`

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Supabase delete succeeds | Card already removed optimistically; `toast.success("Project deleted")`; all delete state reset |
| Supabase delete fails | Card re-inserted at original index; `toast.error("Failed to delete project")`; all delete state reset |
| User not authenticated | RLS rejects the call; caught as error → `toast.error` path |
| Trash clicked while `isDeleting` | `handleDeleteClick` is a no-op |
| Escape / outside-click while in-flight | `cancelDelete` is a no-op; dialog stays open until operation completes |
| Escape / outside-click while confirming | Dialog closes; `pendingDeleteId` cleared |

---

## Testing

- Unit test `deleteProject()` in `projects.ts` with a mock Supabase client: success path, error path
- Unit test `useProjectsDashboard` hook with `renderHook`:
  - Optimistic removal on confirm
  - State restored at correct index on failure
  - `pendingDeleteId` cleared on cancel
  - `handleDeleteClick` no-op when `isDeleting` is true
  - `cancelDelete` no-op when `isDeleting` is true
- Manual smoke test: delete a project, confirm card disappears, refresh page to verify row is gone from Supabase

---

## Out of Scope

- Bulk delete (V2)
- Undo/restore after delete (V2)
- Backend `DELETE /api/projects/:id` endpoint (not needed; RLS covers security)
