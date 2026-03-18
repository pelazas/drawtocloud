# Thumbnail Improvement Design

**Date:** 2026-03-18
**Issue:** [#58](https://github.com/pelazas/drawtocloud/issues/58)
**Scope:** Rewrite `_render_thumbnail()` in `backend/thumbnail_generator.py` to produce a graph-style image that mirrors the frontend canvas.

---

## Problem

The current thumbnail renderer places nodes in a rigid 4-column grid with straight-line edges. It looks like debug output, not a polished architecture diagram. When shared on social platforms via OG tags, the image does not represent the quality of the product.

## Goal

Generate a 1200x630 PNG that resembles the React Flow canvas: hierarchical graph layout, styled nodes with category-colored accents, bezier-curve edges, and DrawToCloud branding.

---

## Design

### Layout algorithm

- Use **grandalf** (pure-Python Sugiyama layout) for hierarchical graph positioning, replacing the 4-column grid. grandalf implements the same layered/Sugiyama-style algorithm that Dagre uses on the frontend.
- Direction: **top-to-bottom** (matching the frontend's top-level `rankdir: "TB"`).
- All nodes are **flattened** — no container/child distinction. Every service is a top-level node.
- After layout, compute the bounding box of all node positions, then uniformly scale and translate to fit within the drawable area of the canvas:
  - **Top margin:** 70px (below title)
  - **Bottom margin:** 50px (above branding/badge)
  - **Left/right margin:** 60px
  - Preserve aspect ratio (uniform scale, center the result).
- **Degenerate cases:** Single node is centered. Two nodes are placed vertically centered with spacing.

### Node rendering

| Property | Value |
|----------|-------|
| Fill | `#1F2937` (gray-800) |
| Border | 1px `#374151` (gray-700), rounded rectangle (radius 8) |
| Left accent | 3px bar in category color (drawn as a filled rectangle on the left edge, clipped to the node's rounded corners) |
| Label | White (`#FFFFFF`), centered, 14px, truncated at 20 chars |
| Size | 140w x 50h |

### Edge rendering

| Property | Value |
|----------|-------|
| Style | Quadratic bezier curve (bottom-center of source → top-center of target), rendered as a polyline by sampling ~20 points along the curve |
| Color | `#6B7280` (gray-500) |
| Width | 2px |
| Arrowhead | Filled triangle, 8px base x 10px height, at target end, same color as edge |

### Background

- Color: `#02040c` (app's page background, replacing current `#0F1117`).

### Title

- Project title, top-left (40, 30), white, 24px. Truncated at 60 chars.

### Branding

- "drawtocloud" wordmark at (40, CANVAS_H - 40).
- "draw" and "cloud" in `#9CA3AF` (gray-400), "to" in `#FFFFFF` (white).
- Font size: 14px.

### Metadata badge

- Bottom-right at (CANVAS_W - 40, CANVAS_H - 40), right-aligned.
- Text: "{N} services" in `#6B7280` (gray-500), 12px.
- Cost is **not shown** in this iteration (not available in the current function signature).

### Font handling

- Use Pillow's `ImageFont.load_default(size=N)` (Pillow 10+). The project already depends on Pillow 10+ and uses this pattern.
- No bundled TTF files — the default font is acceptable for OG thumbnails which are displayed at small sizes on social platforms.
- Preserve the existing `_load_font()` fallback for Pillow < 10 compatibility.

---

## File changes

| File | Change |
|------|--------|
| `backend/thumbnail_generator.py` | Rewrite `_render_thumbnail()` with grandalf layout, bezier edges, styled nodes, branding |
| `backend/pyproject.toml` | Add `grandalf` dependency |

## What stays the same

- Function signature: `generate_and_upload_thumbnail(project_id, title, nodes, edges)`
- Output: 1200x630 PNG bytes
- Supabase upload flow, async wrapper, error handling
- Integration points in `generation_service.py` (no changes needed)

## Testing

- Existing tests in `backend/tests/test_thumbnail_generator.py` must continue to pass (they test upload, error handling, empty nodes, missing keys).
- Add a test verifying that `_render_thumbnail()` produces a valid PNG of the correct dimensions (1200x630) with a non-trivial node/edge set.
- Add a test for degenerate cases: 0 nodes, 1 node, 2 disconnected nodes.

## Dependencies

- **grandalf** — pure Python library implementing Sugiyama-style hierarchical graph layout. No C extensions, no system dependencies.
