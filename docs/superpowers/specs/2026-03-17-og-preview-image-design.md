# OG Preview Image — Design Spec
**Issue:** #27 — T18: Share Links — OpenGraph Preview Image (Diagram Snapshot)
**Date:** 2026-03-17

## Overview

When a project's generation pipeline completes, the backend generates a 1200×630 PNG thumbnail of the architecture diagram and stores it in Supabase Storage. The public URL is saved to the `projects` row. The shared page (`/p/[slug]`) reads this URL and includes it in OpenGraph and Twitter Card metadata so social share previews show a visual snapshot of the diagram.

---

## Data Layer

### Supabase Storage Bucket
- **Name:** `thumbnails`
- **Access:** Public read (no RLS needed for reads; service-role key used for writes)
- **Path pattern:** `<project_id>.png` inside the `thumbnails` bucket
- **Setup:** Manual step — create the bucket via the Supabase dashboard before deploying. Add a startup assertion in `main.py` that logs a warning (not a crash) if the bucket is unreachable.
- **Upsert:** Uploads use `upsert=True` (Python bool) so re-runs overwrite the existing thumbnail at the same path.

### DB Schema
New column on the `projects` table:
```sql
ALTER TABLE projects ADD COLUMN thumbnail_url TEXT NULL;
```

### Frontend Type (`frontend/lib/projects.ts`)
1. Add `thumbnailUrl: string | null` to `PersistedProject`.
2. In `mapProjectRow`, add the explicit line:
   ```ts
   thumbnailUrl: asNonEmptyString(row.thumbnail_url),
   ```

---

## Backend — Thumbnail Generator

**New file:** `backend/thumbnail_generator.py`

**Function signature:**
```python
async def generate_and_upload_thumbnail(
    project_id: str,
    title: str,
    nodes: list[dict],
    edges: list[dict],
) -> str | None:
    """
    Renders a 1200x630 PNG diagram thumbnail using Pillow.
    Uploads to Supabase Storage bucket 'thumbnails' using the shared
    service-role client from supabase_client.py.
    Returns the public URL, or None on any failure.
    Never raises — all exceptions are caught and logged.
    """
```

**Supabase client:** Uses `from supabase_client import supabase`. Upload call:
```python
supabase.storage.from_("thumbnails").upload(
    f"{project_id}.png",
    png_bytes,
    {"content-type": "image/png", "upsert": "true"},  # string — supabase-py 2.x serializes this to x-upsert header
)
url = supabase.storage.from_("thumbnails").get_public_url(f"{project_id}.png")
```
Note: `supabase-py` v2 `FileOptions` passes these as HTTP headers; `"upsert"` must be the string `"true"` not a Python `bool` to ensure correct serialization across patch versions.

**Font:** Use `ImageFont.load_default(size=N)` (Pillow ≥ 10). If `load_default` doesn't accept `size` (older Pillow), fall back to the no-arg default. No external font file required — the rendering is functional, not pixel-perfect.

**Node layout:** Positions are computed from scratch by the thumbnail generator using a grid layout. Do **not** use `position.x`/`position.y` from the node dicts — these may not be populated at pipeline completion time (architect streaming events do not include positions).

**Layout algorithm:**
- Padding: 20px sides, 80px top (title area), 20px bottom
- Grid: rows of 4 nodes, left-to-right, top-to-bottom
- Node size: 160×60 px, 20px horizontal gap, 20px vertical gap
- Node overflow: if nodes exceed canvas height, remaining nodes are omitted (not clipped mid-box)
- A node-id → (cx, cy) map is built during layout and used for edge drawing

**Rendering spec:**
- Canvas: 1200×630 px, background `#0F1117`
- Title: position (40, 30), white, bold, 24px — truncated to 60 chars
- Nodes: filled rounded rectangles, colored by `node["data"]["category"]`:
  - `network` → `#3B82F6` (blue)
  - `compute` → `#F97316` (orange)
  - `database` → `#22C55E` (green)
  - `storage` → `#EAB308` (yellow)
  - `security` → `#EF4444` (red)
  - `monitoring` → `#A855F7` (purple)
  - default / unknown → `#6B7280` (gray)
- Node labels: white text, centered in box, 14px, truncated to 20 chars; read from `node["data"]["label"]`
- Edges: `#4B5563` lines drawn from center of source node box to center of target node box; source/target looked up by `node["id"]` against the computed layout map; edges with unresolvable source or target are skipped silently

**Failure handling:** All exceptions (Pillow errors, upload errors, missing keys in node dicts) are caught at the top-level `try/except`, logged with `logger.warning`, and `None` is returned.

**Dependencies:** Add `pillow>=10.0` to the `dependencies` list in `backend/pyproject.toml` (the project uses `uv`/`pyproject.toml`, not `requirements.txt`).

---

## Backend — Pipeline Integration

### Call site — full generation (`_run_generation`)

After `send_text(done)` fires (which triggers `_handle_done` and writes `nodes`/`edges`/`terraform_files` to the DB), run thumbnail generation as a separate `update_project_fields` call. This avoids any clobber risk — Supabase `.update()` is a partial update, but `_handle_done` does not include `thumbnail_url` in its field set, so the order matters:

The thumbnail block goes **inside the existing `try` block**, immediately after `send_text(done)` (line 806) and before `emit_pipeline_event` (line 807). This ensures `set_generation_state(status="completed")` still runs even if the thumbnail call is slow, since all exceptions are swallowed internally.

```python
# Inside the try block in _run_generation:
await runtime.send_text(json.dumps({"type": "done"}))  # triggers _handle_done internally

# NEW — thumbnail generation after done; _handle_done has already written nodes/edges to DB
title = requirements.get("app_name") or "Untitled"
thumbnail_url = None
try:
    thumbnail_url = await asyncio.wait_for(
        generate_and_upload_thumbnail(
            project_id,
            title,
            diagram_nodes,  # already-captured list from before the TaskGroup
            list(runtime.persistence.edges),
        ),
        timeout=15.0,
    )
except Exception:
    logger.warning("Thumbnail generation timed out or failed for project_id=%s", project_id)
if thumbnail_url:
    await update_project_fields(project_id, user_id, {"thumbnail_url": thumbnail_url})

# Existing lines continue:
await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed")
await runtime.set_generation_state(status="completed", stage="completed", completed=True)
```

### Call site — agent rerun (`_run_agent_rerun`)

Same pattern, after the TaskGroup and `send_text(done)`. Use the **`diagram_nodes` parameter** (nodes passed into the function by the caller), since the architect does not re-run during reruns and `runtime.persistence.nodes` is not repopulated:

```python
# Inside the try block in _run_agent_rerun, after send_text(done):
title = requirements.get("app_name") or "Untitled"
thumbnail_url = None
try:
    thumbnail_url = await asyncio.wait_for(
        generate_and_upload_thumbnail(
            project_id,
            title,
            diagram_nodes,                       # caller-supplied nodes parameter
            list(runtime.persistence.edges),     # seeded from project row at runtime init
        ),
        timeout=15.0,
    )
except Exception:
    logger.warning("Thumbnail generation failed for project_id=%s", project_id)
if thumbnail_url:
    await update_project_fields(project_id, user_id, {"thumbnail_url": thumbnail_url})
```
Note: `runtime.persistence.edges` is seeded from the project row in `_seed_from_project_row` at runtime init, so it contains the existing edges even in a rerun context where the architect does not re-stream.

### Timing semantics
Thumbnail generation is **awaited with a 15-second timeout** after `done` is sent. The client receives `done` first; `thumbnail_url` is written shortly after. Since thumbnails are only consumed when a share URL is opened (not during the live pipeline session), the slight delay is acceptable. If generation exceeds 15 seconds or fails, `thumbnail_url` remains `null` for that project and the share page renders without an `og:image`.

---

## Frontend — OG Metadata

**File:** `frontend/app/p/[slug]/page.tsx`

Update `generateMetadata` to include the thumbnail URL in OG and Twitter Card tags:

```ts
openGraph: {
  title: `${project.title} | DrawToCloud`,
  description,
  url,
  type: "article",
  siteName: "DrawToCloud",
  images: project.thumbnailUrl
    ? [{ url: project.thumbnailUrl, width: 1200, height: 630, alt: project.title }]
    : [],
},
twitter: {
  card: "summary_large_image",
  title: `${project.title} | DrawToCloud`,
  description,
  images: project.thumbnailUrl ? [project.thumbnailUrl] : undefined,
},
```

No other frontend changes required.

---

## Data Contract Updates (per CLAUDE.md)

**`documents/data-reference.md` — sections to update:**
1. **`projects` table entity** — add `thumbnail_url: TEXT | NULL` column
2. **Agent pipeline data flow** — add post-`done` step: "thumbnail generation (Pillow) → Supabase Storage upload → `thumbnail_url` written to `projects` row (fire-with-timeout, does not block pipeline)"

---

## Testing

- **Unit tests** (`backend/tests/test_thumbnail_generator.py`):
  - Mock `supabase.storage` and assert upload called with correct path and `upsert=True`
  - Assert returned string is the public URL on success
  - Assert returns `None` (no raise) when Pillow throws
  - Assert returns `None` (no raise) when upload throws
  - Assert nodes beyond canvas height are omitted, not causing a crash
  - Assert edges with unknown source/target are skipped, not causing a crash

- **Integration smoke test**: After a full pipeline run, assert `projects.thumbnail_url` is non-null and the URL returns HTTP 200.

- **Frontend unit test** (`frontend/app/p/[slug]/page.tsx`): Assert `generateMetadata` includes `og:image` when `thumbnailUrl` is set and omits it when `null`.

---

## Out of Scope

- Animated GIF or video preview (V2)
- User-facing thumbnail preview in the dashboard (V2)
