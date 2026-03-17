# OG Preview Image Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a 1200×630 PNG thumbnail of the architecture diagram after each pipeline run, store it in Supabase Storage, and surface it as `og:image` on shared project pages.

**Architecture:** The backend generates the thumbnail with Pillow after the pipeline's `done` event is sent (so `_handle_done` already committed nodes/edges). The public Supabase Storage URL is saved to `projects.thumbnail_url`. The Next.js shared page reads this field and injects it into OpenGraph + Twitter Card metadata.

**Tech Stack:** Python 3.12, Pillow ≥ 10, supabase-py 2.28+, Next.js 14 App Router metadata API.

---

## File Map

| File | Change |
|------|--------|
| `backend/pyproject.toml` | Add `pillow>=10.0` to `dependencies` |
| `backend/thumbnail_generator.py` | **NEW** — Pillow render + Supabase Storage upload |
| `backend/tests/test_thumbnail_generator.py` | **NEW** — unit tests for thumbnail generator |
| `backend/generation_service.py` | Add thumbnail call in `_run_generation` (line ~806) and `_run_agent_rerun` (line ~593) |
| `backend/main.py` | Add bucket existence warning to `_lifespan` |
| `frontend/lib/projects.ts` | Add `thumbnailUrl` to `PersistedProject` type and `mapProjectRow` |
| `frontend/app/p/[slug]/page.tsx` | Add `og:image` to `generateMetadata` |
| `documents/data-reference.md` | Update `projects` table entity + pipeline data flow |

---

## Pre-flight: Manual Supabase Setup

Before running any tests, create the storage bucket manually:

1. Open your Supabase project dashboard → Storage → New bucket
2. Name: `thumbnails`
3. Public: **yes** (enables unauthenticated reads via public URL)
4. Click Save

---

## Task 1: Add Pillow dependency

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add pillow to pyproject.toml**

Open `backend/pyproject.toml` and add `"pillow>=10.0"` to the `dependencies` list:

```toml
dependencies = [
    "anthropic>=0.84.0",
    "cryptography>=42.0.0",
    "fastapi>=0.135.1",
    "openai>=2.26.0",
    "pillow>=10.0",
    "python-dotenv>=1.2.2",
    "supabase>=2.28.0",
    "uvicorn[standard]>=0.41.0",
    "websockets>=11,<16",
]
```

- [ ] **Step 2: Sync the venv**

```bash
cd backend && uv sync
```

Expected: Pillow downloaded and installed with no errors.

- [ ] **Step 3: Verify import works**

```bash
cd backend && uv run python -c "from PIL import Image, ImageDraw, ImageFont; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "chore: add pillow dependency for OG thumbnail generation"
```

---

## Task 2: Add DB column

**Files:**
- Supabase dashboard / SQL editor

- [ ] **Step 1: Run migration in Supabase SQL editor**

Open your Supabase project → SQL editor and run:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NULL;
```

Expected: "Success. No rows affected."

- [ ] **Step 2: Verify column exists**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'projects' AND column_name = 'thumbnail_url';
```

Expected: one row — `thumbnail_url | text | YES`.

---

## Task 3: Thumbnail generator — write failing tests first

**Files:**
- Create: `backend/tests/test_thumbnail_generator.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_thumbnail_generator.py`:

```python
import io
from unittest.mock import MagicMock, patch, AsyncMock

import pytest


NODES = [
    {"id": "vpc", "data": {"label": "VPC", "category": "network"}},
    {"id": "alb", "data": {"label": "Load Balancer", "category": "compute"}},
    {"id": "rds", "data": {"label": "RDS PostgreSQL", "category": "database"}},
]
EDGES = [
    {"source": "alb", "target": "rds"},
    {"source": "vpc", "target": "alb"},
]


@pytest.fixture
def mock_supabase_storage():
    """Mock supabase.storage so tests don't hit the network."""
    mock_storage = MagicMock()
    mock_bucket = MagicMock()
    mock_storage.from_.return_value = mock_bucket
    mock_bucket.upload.return_value = MagicMock()
    mock_bucket.get_public_url.return_value = "https://example.supabase.co/storage/v1/object/public/thumbnails/test-id.png"
    return mock_storage, mock_bucket


@pytest.mark.asyncio
async def test_returns_public_url_on_success(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("test-id", "My App", NODES, EDGES)

    assert url == "https://example.supabase.co/storage/v1/object/public/thumbnails/test-id.png"


@pytest.mark.asyncio
async def test_upload_called_with_correct_path(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-123", "My App", NODES, EDGES)

    mock_storage.from_.assert_called_with("thumbnails")
    call_args = mock_bucket.upload.call_args
    assert call_args[0][0] == "proj-123.png"
    # third arg options must have upsert as string "true"
    options = call_args[0][2]
    assert options.get("upsert") == "true"
    assert options.get("content-type") == "image/png"


@pytest.mark.asyncio
async def test_upload_receives_valid_png_bytes(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-abc", "My App", NODES, EDGES)

    png_bytes = mock_bucket.upload.call_args[0][1]
    assert isinstance(png_bytes, bytes)
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic bytes


@pytest.mark.asyncio
async def test_returns_none_on_upload_error():
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage.from_.return_value.upload.side_effect = Exception("network error")
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-err", "My App", NODES, EDGES)

    assert url is None


@pytest.mark.asyncio
async def test_empty_nodes_does_not_crash():
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage.from_.return_value.upload.return_value = MagicMock()
        mock_sb.storage.from_.return_value.get_public_url.return_value = "https://example.com/thumb.png"
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-empty", "My App", [], [])

    # An empty diagram still produces a (blank) thumbnail — upload is called
    assert mock_sb.storage.from_.return_value.upload.called


@pytest.mark.asyncio
async def test_skips_edges_with_unknown_nodes(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    bad_edges = [{"source": "ghost", "target": "phantom"}]
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        # Must not raise even with unresolvable edge endpoints
        url = await generate_and_upload_thumbnail("proj-ghost", "My App", NODES, bad_edges)

    assert mock_bucket.upload.called  # still produced a PNG


@pytest.mark.asyncio
async def test_nodes_beyond_canvas_do_not_crash(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    # 30 nodes — exceeds canvas height at standard grid sizes
    many_nodes = [
        {"id": f"node-{i}", "data": {"label": f"Service {i}", "category": "compute"}}
        for i in range(30)
    ]
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        url = await generate_and_upload_thumbnail("proj-many", "Big App", many_nodes, [])

    assert mock_bucket.upload.called


@pytest.mark.asyncio
async def test_node_missing_data_key_does_not_crash(mock_supabase_storage):
    mock_storage, mock_bucket = mock_supabase_storage
    bad_nodes = [{"id": "x"}]  # no "data" key
    with patch("thumbnail_generator.supabase") as mock_sb:
        mock_sb.storage = mock_storage
        from thumbnail_generator import generate_and_upload_thumbnail
        await generate_and_upload_thumbnail("proj-bad", "My App", bad_nodes, [])

    assert mock_bucket.upload.called
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
cd backend && uv run pytest tests/test_thumbnail_generator.py -v 2>&1 | head -30
```

Expected: all fail with `ModuleNotFoundError: No module named 'thumbnail_generator'`.

---

## Task 4: Implement thumbnail_generator.py

**Files:**
- Create: `backend/thumbnail_generator.py`

- [ ] **Step 1: Write the implementation**

Create `backend/thumbnail_generator.py`:

```python
import asyncio
import io
import logging
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from supabase_client import supabase

logger = logging.getLogger(__name__)

# Canvas dimensions (standard OG image size)
CANVAS_W = 1200
CANVAS_H = 630
BG_COLOR = "#0F1117"

# Grid layout constants
PADDING_X = 20
PADDING_TOP = 80   # space for title
PADDING_BOTTOM = 20
NODE_W = 160
NODE_H = 60
GAP_X = 20
GAP_Y = 20
COLS = 4

# Category → hex color
CATEGORY_COLORS: dict[str, str] = {
    "network": "#3B82F6",
    "compute": "#F97316",
    "database": "#22C55E",
    "storage": "#EAB308",
    "security": "#EF4444",
    "monitoring": "#A855F7",
}
DEFAULT_COLOR = "#6B7280"

EDGE_COLOR = "#4B5563"
LABEL_COLOR = "#FFFFFF"
TITLE_COLOR = "#FFFFFF"


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        # Pillow < 10 doesn't support size argument
        return ImageFont.load_default()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    radius: int,
    fill: tuple[int, int, int],
) -> None:
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill)


def _render_thumbnail(title: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> bytes:
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), _hex_to_rgb(BG_COLOR))
    draw = ImageDraw.Draw(img)

    title_font = _load_font(24)
    label_font = _load_font(14)

    # Draw title
    draw.text((40, 30), title[:60], fill=_hex_to_rgb(TITLE_COLOR), font=title_font)

    # Compute grid positions — ignore stored position.x/y, recompute from scratch
    positions: dict[str, tuple[int, int]] = {}  # node_id -> center (cx, cy)
    available_h = CANVAS_H - PADDING_TOP - PADDING_BOTTOM

    for i, node in enumerate(nodes):
        node_id = node.get("id")
        if not node_id:
            continue

        col = i % COLS
        row = i // COLS

        x = PADDING_X + col * (NODE_W + GAP_X)
        y = PADDING_TOP + row * (NODE_H + GAP_Y)

        # Skip nodes that would overflow canvas height
        if y + NODE_H > CANVAS_H - PADDING_BOTTOM:
            continue

        cx = x + NODE_W // 2
        cy = y + NODE_H // 2
        positions[node_id] = (cx, cy)

        data = node.get("data") or {}
        category = data.get("category", "")
        color = CATEGORY_COLORS.get(category, DEFAULT_COLOR)
        label = str(data.get("label", node_id))[:20]

        _draw_rounded_rect(draw, x, y, NODE_W, NODE_H, radius=8, fill=_hex_to_rgb(color))

        # Center label text in box
        try:
            bbox = draw.textbbox((0, 0), label, font=label_font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
        except AttributeError:
            text_w, text_h = draw.textsize(label, font=label_font)  # type: ignore[attr-defined]

        draw.text(
            (x + (NODE_W - text_w) // 2, y + (NODE_H - text_h) // 2),
            label,
            fill=_hex_to_rgb(LABEL_COLOR),
            font=label_font,
        )

    # Draw edges between node centers
    edge_color_rgb = _hex_to_rgb(EDGE_COLOR)
    for edge in edges:
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if not src or not tgt:
            continue
        if src not in positions or tgt not in positions:
            continue
        draw.line([positions[src], positions[tgt]], fill=edge_color_rgb, width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def generate_and_upload_thumbnail(
    project_id: str,
    title: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> str | None:
    """
    Renders a 1200x630 PNG diagram thumbnail using Pillow and uploads it to
    Supabase Storage bucket 'thumbnails'. Returns the public URL on success,
    or None on any failure. Never raises.
    """
    try:
        png_bytes = await asyncio.get_event_loop().run_in_executor(
            None, _render_thumbnail, title, nodes, edges
        )
        supabase.storage.from_("thumbnails").upload(
            f"{project_id}.png",
            png_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
        url: str = supabase.storage.from_("thumbnails").get_public_url(f"{project_id}.png")
        return url
    except Exception:
        logger.warning("Thumbnail generation/upload failed for project_id=%s", project_id, exc_info=True)
        return None
```

- [ ] **Step 2: Run tests — confirm they all pass**

```bash
cd backend && uv run pytest tests/test_thumbnail_generator.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/thumbnail_generator.py backend/tests/test_thumbnail_generator.py
git commit -m "feat: add thumbnail_generator with Pillow rendering and Supabase upload"
```

---

## Task 5: Integrate into generation pipeline

**Files:**
- Modify: `backend/generation_service.py`

- [ ] **Step 1: Add import**

At the top of `backend/generation_service.py`, after the existing imports, add:

```python
from thumbnail_generator import generate_and_upload_thumbnail
```

- [ ] **Step 2: Add thumbnail call in `_run_generation`**

In `_run_generation`, locate this exact block (around line 805–809) — include all four lines to avoid accidentally deleting the log statements:

```python
        logger.info("Parallel agents complete project_id=%s trace_id=%s", project_id, runtime.trace_id)
        await runtime.send_text(json.dumps({"type": "done"}))
        await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed")
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
        logger.info("Generation completed project_id=%s trace_id=%s", project_id, runtime.trace_id)
```

Replace with:

```python
        logger.info("Parallel agents complete project_id=%s trace_id=%s", project_id, runtime.trace_id)
        await runtime.send_text(json.dumps({"type": "done"}))

        # Generate OG thumbnail — awaited with timeout so thumbnail_url is in DB
        # before any crawler hits the share page. Failure must not block done.
        _thumb_title = requirements.get("app_name") or "Untitled"
        _thumbnail_url = None
        try:
            _thumbnail_url = await asyncio.wait_for(
                generate_and_upload_thumbnail(
                    project_id,
                    _thumb_title,
                    diagram_nodes,
                    list(runtime.persistence.edges),
                ),
                timeout=15.0,
            )
        except Exception:
            logger.warning("Thumbnail generation timed out or failed project_id=%s", project_id)
        if _thumbnail_url:
            await update_project_fields(project_id, user_id, {"thumbnail_url": _thumbnail_url})

        await runtime.emit_pipeline_event("pipeline", "completed", "info", "Generation completed")
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
        logger.info("Generation completed project_id=%s trace_id=%s", project_id, runtime.trace_id)
```

- [ ] **Step 3: Add thumbnail call in `_run_agent_rerun`**

In `_run_agent_rerun`, the function signature (line ~520) is:
```python
async def _run_agent_rerun(
    runtime: GenerationRuntime,
    answers: dict[str, Any],
    agent_names: tuple[str, ...],
    diagram_nodes: list[dict[str, Any]],
) -> None:
```
The nodes parameter is called `diagram_nodes` — confirm this before inserting the code below.

Locate this block (around line 593):

```python
        await runtime.send_text(json.dumps({"type": "done"}))
        await runtime.emit_pipeline_event("rerun", "completed", "info", "Selected agents completed")
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
```

Replace with:

```python
        await runtime.send_text(json.dumps({"type": "done"}))

        # Regenerate OG thumbnail after rerun (nodes may have changed)
        _thumb_title = requirements.get("app_name") or "Untitled"
        _thumbnail_url = None
        try:
            _thumbnail_url = await asyncio.wait_for(
                generate_and_upload_thumbnail(
                    project_id,
                    _thumb_title,
                    diagram_nodes,
                    list(runtime.persistence.edges),
                ),
                timeout=15.0,
            )
        except Exception:
            logger.warning("Thumbnail generation failed project_id=%s", project_id)
        if _thumbnail_url:
            await update_project_fields(project_id, user_id, {"thumbnail_url": _thumbnail_url})

        await runtime.emit_pipeline_event("rerun", "completed", "info", "Selected agents completed")
        await runtime.set_generation_state(status="completed", stage="completed", completed=True)
```

- [ ] **Step 4: Run existing generation tests to confirm nothing is broken**

```bash
cd backend && uv run pytest tests/test_generation_service.py tests/test_generation_service_admin.py tests/test_generation_service_byok.py -v
```

Expected: all pass (thumbnail generator is mocked by the existing test infrastructure which patches `supabase_client`).

If tests reference the thumbnail generator and fail, add a mock patch at the top of the relevant test files:

```python
from unittest.mock import patch, AsyncMock
# At the start of any test that exercises _run_generation:
with patch("generation_service.generate_and_upload_thumbnail", new_callable=AsyncMock, return_value=None):
    ...
```

- [ ] **Step 5: Commit**

```bash
git add backend/generation_service.py
git commit -m "feat: generate OG thumbnail after pipeline completion"
```

---

## Task 6: Startup bucket warning in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add bucket warning to lifespan**

In `backend/main.py`, find the `_lifespan` function:

```python
@asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    _assert_single_worker()
    await reset_stale_generations()
    yield
```

Replace with:

```python
@asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    _assert_single_worker()
    await reset_stale_generations()
    _warn_if_thumbnails_bucket_missing()
    yield


def _warn_if_thumbnails_bucket_missing() -> None:
    """Log a warning if the 'thumbnails' storage bucket is unreachable.

    This is a best-effort check — it does not abort startup. If the bucket
    is missing, thumbnail generation will silently return None at runtime.
    """
    try:
        buckets = supabase.storage.list_buckets()
        names = [b.name for b in buckets] if buckets else []
        if "thumbnails" not in names:
            logger.warning(
                "Supabase Storage bucket 'thumbnails' not found. "
                "OG thumbnail generation will be skipped. "
                "Create the bucket in the Supabase dashboard (public read)."
            )
    except Exception as exc:
        logger.warning("Could not check Supabase Storage buckets: %s", exc)
```

- [ ] **Step 2: Run health tests to confirm startup still works**

```bash
cd backend && uv run pytest tests/test_health.py -v
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: warn at startup if thumbnails storage bucket is missing"
```

---

## Task 7: Frontend — add thumbnailUrl to PersistedProject

**Files:**
- Modify: `frontend/lib/projects.ts`

- [ ] **Step 1: Add field to PersistedProject type**

In `frontend/lib/projects.ts`, find the `PersistedProject` type (around line 21). Add `thumbnailUrl` after `shareSlug`:

```ts
export type PersistedProject = {
  id: string;
  userId: string | null;
  shareSlug: string | null;
  thumbnailUrl: string | null;   // <-- add this line
  title: string;
  // ... rest of fields unchanged
```

- [ ] **Step 2: Add mapping in mapProjectRow**

In `mapProjectRow` (around line 267), add after `shareSlug`:

```ts
  return {
    id,
    userId: asNonEmptyString(row.user_id),
    shareSlug: asNonEmptyString(row.share_slug),
    thumbnailUrl: asNonEmptyString(row.thumbnail_url),   // <-- add this line
    title,
    // ... rest unchanged
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If there are errors about `thumbnailUrl` not being provided somewhere, add `thumbnailUrl: null` to any object literals that construct a `PersistedProject` directly (e.g., in tests or mocks).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/projects.ts
git commit -m "feat: add thumbnailUrl field to PersistedProject"
```

---

## Task 8: Frontend — add og:image to generateMetadata

**Files:**
- Modify: `frontend/app/p/[slug]/page.tsx`

- [ ] **Step 1: Update generateMetadata**

In `frontend/app/p/[slug]/page.tsx`, find the `return` statement inside `generateMetadata` (around line 69). Update the `openGraph` and `twitter` sections:

```ts
  return {
    title: `${project.title} | DrawToCloud`,
    description,
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
    alternates: {
      canonical: url,
    },
  };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Verify dev server starts**

```bash
cd frontend && pnpm dev &
sleep 5 && curl -s http://localhost:3000 | head -5
kill %1
```

Expected: HTML response without crash.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/p/[slug]/page.tsx
git commit -m "feat: add og:image to share page generateMetadata"
```

---

## Task 9: Update data-reference.md

**Files:**
- Modify: `documents/data-reference.md`

- [ ] **Step 1: Open and read the current projects table section**

Find the `projects` table entity definition in `documents/data-reference.md`.

- [ ] **Step 2: Add thumbnail_url column**

Add `thumbnail_url TEXT NULL` to the `projects` table column list, e.g.:

```
| thumbnail_url     | TEXT         | NULL    | Public Supabase Storage URL for OG thumbnail PNG |
```

- [ ] **Step 3: Update pipeline data flow**

Find the agent pipeline data flow section and add a post-`done` step:

```
After `done` event:
  → thumbnail generation (Pillow, 1200×630 PNG) — 15s timeout
  → upload to Supabase Storage bucket `thumbnails/<project_id>.png`
  → `projects.thumbnail_url` updated (non-blocking on failure)
```

- [ ] **Step 4: Commit**

```bash
git add documents/data-reference.md
git commit -m "docs: update data-reference with thumbnail_url column and pipeline step"
```

---

## Final Verification

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && uv run pytest -v 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test the share page manually**

1. Start both services: `./dev.sh` (or `cd backend && uv run uvicorn main:app --reload` + `cd frontend && pnpm dev`)
2. Generate a project and wait for pipeline to complete
3. Check Supabase Storage → thumbnails bucket — confirm a PNG was uploaded
4. Check `projects` table — confirm `thumbnail_url` is non-null
5. Navigate to `/p/<share_slug>` in browser
6. View page source — confirm `<meta property="og:image"` tag is present with the thumbnail URL
