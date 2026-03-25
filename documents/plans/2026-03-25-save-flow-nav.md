# Save Flow & Natural `/` Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove auto-project-creation on `/`, load a default template instead, and add an explicit Save button that creates projects only when the user clicks Save.

**Architecture:** `/` loads a default template (via env var slug) into the canvas without creating a project. Two new backend endpoints (`POST /api/projects` and `PATCH /api/projects/{id}/snapshot`) handle project creation and snapshot saving. A `useSaveProject` hook and `SaveProjectModal` component wire the frontend save flow.

**Tech Stack:** Next.js 14, React, FastAPI, Supabase, Pydantic

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `.env` | Modify | Add `NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG` |
| `frontend/.env.example` | Modify | Add `NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG` |
| `frontend/lib/useWorkspace.ts` | Modify | Remove bootstrap effects, add default template loader |
| `frontend/lib/useSaveProject.ts` | Create | Save logic hook (saveNew + saveExisting) |
| `frontend/lib/projectApi.ts` | Create | API functions for POST /api/projects + PATCH snapshot |
| `frontend/components/SaveProjectModal.tsx` | Create | Name input modal for first save |
| `frontend/components/TopBar.tsx` | Modify | Add Save button with state matrix |
| `frontend/app/page.tsx` | Modify | Wire save props, update empty-state copy |
| `backend/main.py` | Modify | Add POST /api/projects + PATCH /api/projects/{id}/snapshot |
| `backend/project_store.py` | Modify | Add create_named_project + save_canvas_snapshot helpers |
| `documents/data-reference.md` | Modify | Document new API shapes |

---

### Task 1: Env var for default template slug

**Files:**
- Modify: `.env`
- Modify: `frontend/.env.example`

- [ ] **Step 1: Add env var to root `.env`**

Append to `.env`:
```
NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG=aie84ypr
```

- [ ] **Step 2: Add env var to `frontend/.env.example`**

Append to `frontend/.env.example`:
```
NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG=<template-slug>
```

- [ ] **Step 3: Commit**

```bash
git add .env frontend/.env.example
git commit -m "feat: add NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG env var"
```

---

### Task 2: Backend — `POST /api/projects` (create named project)

**Files:**
- Modify: `backend/project_store.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Add `create_named_project` to `project_store.py`**

Add after `create_project_for_generation` (after line 185). This reuses the same slug-generation loop but takes a `name` param and sets `generation_status = "idle"`:

```python
def _create_named_project_sync(user_id: str, name: str) -> dict[str, Any]:
    title = name.strip()[:120] if name.strip() else "Untitled Project"

    payload = {
        "user_id": user_id,
        "title": title,
        "project_mode": "default",
        "questionnaire_answers": {},
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "idle",
        "generation_stage": None,
        "generation_error": None,
        "generation_trace_id": None,
        "generation_started_at": None,
        "generation_completed_at": None,
        "last_event_at": None,
        "setup_pdf_status": "none",
        "setup_pdf_url": None,
        "setup_pdf_storage_path": None,
        "setup_pdf_generated_at": None,
        "setup_pdf_source_revision": None,
        "setup_pdf_error": None,
        "setup_pdf_progress": 0,
        "updated_at": _utc_now(),
    }

    last_error: Exception | None = None
    for _ in range(MAX_SLUG_ATTEMPTS):
        slug = _generate_slug()
        try:
            result = (
                supabase.table("projects")
                .insert({**payload, "share_slug": slug})
                .execute()
            )
        except Exception as error:
            if _is_duplicate_slug_error(error):
                last_error = error
                continue
            raise

        data = getattr(result, "data", None)
        if isinstance(data, list) and data:
            row = data[0]
            if isinstance(row, dict):
                return row

        fetched = (
            supabase.table("projects")
            .select("id, share_slug, title")
            .eq("user_id", user_id)
            .eq("share_slug", slug)
            .single()
            .execute()
        )
        fetched_data = getattr(fetched, "data", None)
        if isinstance(fetched_data, dict):
            return fetched_data

    if last_error is not None:
        raise last_error
    raise RuntimeError("Unable to create project with a unique slug.")


async def create_named_project(user_id: str, name: str) -> dict[str, Any]:
    return await asyncio.to_thread(_create_named_project_sync, user_id, name)
```

- [ ] **Step 2: Add `save_canvas_snapshot` to `project_store.py`**

Add after `create_named_project`:

```python
def _save_canvas_snapshot_sync(
    project_id: str, user_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> None:
    payload = {"nodes": nodes, "edges": edges, "updated_at": _utc_now()}
    response = (
        supabase.table("projects")
        .update(payload)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    data = getattr(response, "data", None)
    if not isinstance(data, list) or len(data) == 0:
        raise RuntimeError("Project not found or not owned by user.")


async def save_canvas_snapshot(
    project_id: str, user_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> None:
    await asyncio.to_thread(_save_canvas_snapshot_sync, project_id, user_id, nodes, edges)
```

**Note:** Unlike `update_project_fields` (which silently logs 0-row matches), this function raises when the update matches no rows — the PATCH endpoint must report failure to the client, not a false success.

- [ ] **Step 3: Add Pydantic models and `POST /api/projects` endpoint to `main.py`**

Add models after `CloneTemplateResponse` (after line 222):

```python
class CreateProjectRequest(BaseModel):
    name: str


class CreateProjectResponse(BaseModel):
    project_id: str
    share_slug: str
```

Add endpoint after the clone template endpoint (after line 596). Uses `Authorization` header (same pattern as setup-pdf, BYOK endpoints):

```python
@app.post(
    "/api/projects",
    summary="Create a named project",
    description="Creates an empty project with the given name. No generation is started.",
    response_model=CreateProjectResponse,
    tags=["projects"],
)
async def create_project_endpoint(req: CreateProjectRequest, authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from project_store import create_named_project

    try:
        row = await create_named_project(auth_user.user_id, req.name)
    except Exception as error:
        raise HTTPException(
            status_code=400, detail={"error": "project_create_failed", "message": str(error)}
        ) from error

    project_id = str(row.get("id", ""))
    share_slug = row.get("share_slug", "")
    if not project_id or not share_slug:
        raise HTTPException(
            status_code=400, detail={"error": "project_create_failed", "message": "Project creation returned incomplete data."}
        )

    return {"project_id": project_id, "share_slug": share_slug}
```

- [ ] **Step 4: Update `main.py` imports**

Add `create_named_project` and `save_canvas_snapshot` to the import from `project_store`.

- [ ] **Step 5: Commit**

```bash
git add backend/project_store.py backend/main.py
git commit -m "feat: add POST /api/projects endpoint for named project creation"
```

---

### Task 3: Backend — `PATCH /api/projects/{id}/snapshot`

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add Pydantic model and PATCH endpoint to `main.py`**

Add model:

```python
class SaveSnapshotRequest(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
```

Add endpoint:

```python
@app.patch(
    "/api/projects/{project_id}/snapshot",
    summary="Save canvas snapshot",
    description="Persists the current canvas state (nodes and edges) for an owned project.",
    tags=["projects"],
)
async def save_snapshot_endpoint(
    project_id: str,
    req: SaveSnapshotRequest,
    authorization: str | None = Header(default=None),
):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from project_store import save_canvas_snapshot

    try:
        await save_canvas_snapshot(project_id, auth_user.user_id, req.nodes, req.edges)
    except Exception as error:
        raise HTTPException(
            status_code=400, detail={"error": "snapshot_save_failed", "message": str(error)}
        ) from error

    return {"ok": True}
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat: add PATCH /api/projects/{id}/snapshot endpoint"
```

---

### Task 4: Frontend — `projectApi.ts` (API client functions)

**Files:**
- Create: `frontend/lib/projectApi.ts`

- [ ] **Step 1: Create `projectApi.ts`**

```typescript
import { getSupabaseBrowserClient } from "./supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ErrorDetail = { detail?: { error?: string; message?: string } };

function parseErrorMessage(body: unknown): string {
  const detail = (body as ErrorDetail).detail;
  if (detail?.message) return detail.message;
  if (detail?.error) return detail.error;
  return "Request failed";
}

async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export type CreateProjectResponse = {
  project_id: string;
  share_slug: string;
};

export async function createProject(name: string): Promise<CreateProjectResponse> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name }),
  });

  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new Error(parseErrorMessage(body));

  const record = body as Record<string, unknown>;
  const projectId = typeof record.project_id === "string" ? record.project_id : "";
  const shareSlug = typeof record.share_slug === "string" ? record.share_slug : "";
  if (!projectId || !shareSlug) throw new Error("Invalid create project response");

  return { project_id: projectId, share_slug: shareSlug };
}

export async function saveSnapshot(
  projectId: string,
  nodes: unknown[],
  edges: unknown[]
): Promise<void> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/snapshot`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ nodes, edges }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as unknown;
    throw new Error(parseErrorMessage(body));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/projectApi.ts
git commit -m "feat: add projectApi.ts with createProject and saveSnapshot"
```

---

### Task 5: Frontend — `useSaveProject.ts` hook

**Files:**
- Create: `frontend/lib/useSaveProject.ts`

- [ ] **Step 1: Create `useSaveProject.ts`**

```typescript
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProject, saveSnapshot } from "./projectApi";
import { resolveProjectRedirectPath } from "./generationStart";
import type { PersistedProject } from "./projects";
import type { Edge, Node } from "reactflow";

type UseSaveProjectArgs = {
  currentProject: PersistedProject | null;
  isOwner: boolean;
  nodes: Node[];
  edges: Edge[];
};

export function useSaveProject({ currentProject, isOwner, nodes, edges }: UseSaveProjectArgs) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const canSave = Boolean(
    currentProject ? isOwner : true
  );

  const handleSaveClick = useCallback(() => {
    if (currentProject && isOwner) {
      // Existing project — silent save
      setSaving(true);
      void saveSnapshot(currentProject.id, nodes, edges)
        .then(() => toast.success("Saved"))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to save")
        )
        .finally(() => setSaving(false));
    } else if (!currentProject) {
      // No project yet — open name modal
      setShowModal(true);
    }
  }, [currentProject, isOwner, nodes, edges]);

  const saveNew = useCallback(
    async (name: string) => {
      setSaving(true);
      try {
        const result = await createProject(name);
        await saveSnapshot(result.project_id, nodes, edges);
        router.replace(resolveProjectRedirectPath(result.share_slug));
        toast.success("Project saved");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to save project");
      } finally {
        setSaving(false);
        setShowModal(false);
      }
    },
    [nodes, edges, router]
  );

  const closeModal = useCallback(() => setShowModal(false), []);

  return { saving, showModal, canSave, handleSaveClick, saveNew, closeModal };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/useSaveProject.ts
git commit -m "feat: add useSaveProject hook"
```

---

### Task 6: Frontend — `SaveProjectModal.tsx`

**Files:**
- Create: `frontend/components/SaveProjectModal.tsx`

- [ ] **Step 1: Create `SaveProjectModal.tsx`**

```tsx
"use client";

import { useCallback, useRef, useState } from "react";

interface SaveProjectModalProps {
  open: boolean;
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}

export default function SaveProjectModal({ open, saving, onSave, onClose }: SaveProjectModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      onSave(trimmed);
    },
    [name, onSave]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-4"
      >
        <h2 className="text-sm font-semibold text-white">Save Project</h2>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          autoFocus
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/SaveProjectModal.tsx
git commit -m "feat: add SaveProjectModal component"
```

---

### Task 7: Remove auto-bootstrap from `useWorkspace.ts`

**Files:**
- Modify: `frontend/lib/useWorkspace.ts`

- [ ] **Step 1: Remove `bootstrapAttemptedRef` declaration**

Delete line 35:
```typescript
const bootstrapAttemptedRef = useRef(false);
```

- [ ] **Step 2: Remove the two bootstrap effects (lines 199-210)**

Delete:
```typescript
  useEffect(() => {
    if (!user || projectSlug || currentProject || creatingProject) return;
    if (bootstrapAttemptedRef.current) return;
    bootstrapAttemptedRef.current = true;
    void startFromScratch();
  }, [creatingProject, currentProject, projectSlug, startFromScratch, user]);

  useEffect(() => {
    if (!user || projectSlug) {
      bootstrapAttemptedRef.current = false;
    }
  }, [projectSlug, user]);
```

- [ ] **Step 3: Remove unused `useRef` import if no other refs remain**

Check if `useRef` is still used elsewhere in the file. If not, remove it from the import.

- [ ] **Step 4: Add default template loader effect**

Add after the existing `loadProjectBySlug` effect (after the effect that was at line 197), before the `projectSummaries` memo:

```typescript
  useEffect(() => {
    if (projectSlug || currentProject) return;
    const slug = process.env.NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG;
    if (!slug) {
      console.warn("NEXT_PUBLIC_DEFAULT_TEMPLATE_SLUG not set — landing on / shows empty canvas");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { fetchTemplateDetail } = await import("@/lib/templates");
        const template = await fetchTemplateDetail(slug);
        if (!cancelled) {
          pipeline.loadTemplateSnapshot(template);
        }
      } catch {
        // Silently fail — user sees empty canvas
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectSlug, currentProject, pipeline]);
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/useWorkspace.ts
git commit -m "feat: remove auto-bootstrap, load default template on /"
```

---

### Task 8: Wire Save button into `TopBar.tsx` and `page.tsx`

**Files:**
- Modify: `frontend/components/TopBar.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Add save props to `TopBar.tsx`**

Add to `TopBarProps`:
```typescript
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
```

Add the Save button in the right section, before the "Generate Terraform" button:

```tsx
{onSave && (
  <button
    type="button"
    onClick={onSave}
    disabled={saveDisabled || saving}
    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-700/80 bg-gray-800/90 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-100 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar disabled:opacity-50"
  >
    <Save size={14} />
    {saving ? "Saving..." : "Save"}
  </button>
)}
```

Add `Save` to the lucide-react import.

- [ ] **Step 2: Wire save hook in `page.tsx`**

Import `useSaveProject` and `SaveProjectModal`. Add the hook call in `WorkspaceContent`:

```typescript
const saveProject = useSaveProject({
  currentProject: workspace.currentProject,
  isOwner: workspace.isOwner,
  nodes: pipeline.nodes,
  edges: pipeline.edges,
});
```

Determine whether to show the save button:
```typescript
const showSave = workspace.user && (!workspace.currentProject || workspace.isOwner);
```

Pass props to `TopBar`:
```tsx
onSave={showSave ? saveProject.handleSaveClick : undefined}
saveDisabled={!saveProject.canSave}
saving={saveProject.saving}
```

Add `SaveProjectModal` after the `TopBar`:
```tsx
<SaveProjectModal
  open={saveProject.showModal}
  saving={saveProject.saving}
  onSave={saveProject.saveNew}
  onClose={saveProject.closeModal}
/>
```

- [ ] **Step 3: Update empty-state copy in `page.tsx`**

Change the empty-state overlay (lines 158-168). The default template now loads on `/`, so the overlay only shows briefly during load or when the env var is missing. Keep the `creatingProject` branch for "Describe your app" flows, but change the idle state:
- Creating project (via Describe your app): "Creating project..." (keep as-is)
- Logged in, idle: "Explore the canvas or describe your app to start."
- Not logged in: "Sign in to start designing"

- [ ] **Step 4: Commit**

```bash
git add frontend/components/TopBar.tsx frontend/app/page.tsx
git commit -m "feat: add Save button to TopBar and wire save flow"
```

---

### Task 9: Update `data-reference.md`

**Files:**
- Modify: `documents/data-reference.md`

- [ ] **Step 1: Add API shapes for new endpoints**

Append a new section documenting the two new endpoints:

```markdown
### POST /api/projects

Creates a named project without starting generation.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**
```json
{ "name": "My App" }
```

**Response:**
```json
{ "project_id": "uuid", "share_slug": "abc12345" }
```

### PATCH /api/projects/{project_id}/snapshot

Saves the current canvas state for an owned project.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**
```json
{ "nodes": [...], "edges": [...] }
```

**Response:**
```json
{ "ok": true }
```
```

- [ ] **Step 2: Commit**

```bash
git add documents/data-reference.md
git commit -m "docs: add POST /api/projects and PATCH snapshot to data-reference"
```

---

### Task 10: Cleanup and verify

- [ ] **Step 1: Check for leftover references to `startFromScratch` in auto-bootstrap context**

The `startFromScratch` function itself should remain — it's still used by "Describe your app" button and "Generate Terraform" fallback.

- [ ] **Step 2: Verify `useRef` import can be removed from `useWorkspace.ts`**

If `bootstrapAttemptedRef` was the only ref, remove `useRef` from the import line.

- [ ] **Step 3: Run frontend build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 4: Run backend syntax check**

```bash
cd backend && python -c "import main; import project_store"
```

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: cleanup after save flow implementation"
```
