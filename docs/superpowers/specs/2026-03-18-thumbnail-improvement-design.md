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

- Use **networkx** for hierarchical (layered/sugiyama-style) graph positioning, replacing the 4-column grid.
- Direction: **top-to-bottom** (matching the frontend's top-level `rankdir: "TB"`).
- All nodes are **flattened** — no container/child distinction. Every service is a top-level node.
- After layout, translate and scale the node positions to fill the canvas with padding (leave room for title at top, branding at bottom).

### Node rendering

| Property | Value |
|----------|-------|
| Fill | `#1F2937` (gray-800) |
| Border | 1px `#374151` (gray-700), rounded rectangle (radius 8) |
| Left accent | 3px bar in category color |
| Label | White (`#FFFFFF`), centered, 14px, truncated at 20 chars |
| Size | 140w x 50h |

### Edge rendering

| Property | Value |
|----------|-------|
| Style | Quadratic bezier curve (bottom of source to top of target) |
| Color | `#6B7280` (gray-500) |
| Width | 1.5px |
| Arrowhead | Small filled triangle at target end |

### Background

- Color: `#02040c` (app's page background, replacing current `#0F1117`).

### Title

- Project title, top-left (40, 30), white, 24px. Truncated at 60 chars.

### Branding

- "drawtocloud" wordmark, bottom-left corner.
- "draw" and "cloud" in `#9CA3AF` (gray-400), "to" in `#FFFFFF` (white).
- Small font size (14px).

### Metadata badge

- Bottom-right corner: "{N} services | ~${cost}/mo" in `#6B7280` (gray-500), 12px.
- Cost portion only shown if cost data is available.

---

## File changes

| File | Change |
|------|--------|
| `backend/thumbnail_generator.py` | Rewrite `_render_thumbnail()` with networkx layout, new node/edge/branding rendering |
| `backend/requirements.txt` | Add `networkx` |

## What stays the same

- Function signature: `generate_and_upload_thumbnail(project_id, title, nodes, edges)`
- Output: 1200x630 PNG bytes
- Supabase upload flow, async wrapper, error handling
- Integration points in `generation_service.py` (no changes needed)

## Dependencies

- **networkx** — pure Python graph library for layout computation. Lightweight, no C extensions required.
