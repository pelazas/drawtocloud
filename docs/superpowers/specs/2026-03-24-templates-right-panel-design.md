# Templates in Right Panel — Design Spec

**Issue:** [#101](https://github.com/pelazas/drawtocloud/issues/101)
**Date:** 2026-03-24

## Overview

Move template browsing into the collapsible right panel. Users click "Templates" in the TopBar, browse a grid of template cards, and click one to load it onto the canvas in-place (replacing current nodes/edges).

## Backend

### New endpoint: `GET /api/templates/{slug}`

Returns full template data for a single template. Public (no auth required).

> **Note:** The existing `POST /api/templates/{slug}/clone` endpoint remains unchanged — it is used for clone-based flows (e.g., future use cases). The new GET endpoint serves a different purpose: fetching template data for in-place canvas loading without creating a new project. The frontend `cloneTemplate()` function and `CloneTemplateResponse` type in `templates.ts` are kept as-is (not dead code — they may be used by other flows).

**Response shape:**

```json
{
  "title": "Three-Tier Web App",
  "share_slug": "abc123",
  "thumbnail_url": null,
  "nodes": [ { "id": "vpc", "type": "awsNode", "position": { "x": 0, "y": 0 }, "data": { "label": "VPC", "category": "network" } } ],
  "edges": [ { "id": "e-vpc-alb", "source": "vpc", "target": "alb", "label": "routes to" } ],
  "terraform_files": [ { "filename": "main.tf", "content": "..." } ],
  "cost_estimate": { "monthly_total": 142.50, "breakdown": [] },
  "arch_description": { "sections": {} }
}
```

> **Auth note:** This endpoint is intentionally public. Templates are curated showcase content, not user-private data. The existing `GET /api/templates` list endpoint is also public. The clone endpoint remains auth-gated because it creates a user-owned project and consumes quota.

**Error responses:**
- `404` — template not found

**Implementation:** Query Supabase for projects where `is_template = True` and `share_slug = {slug}`. Return full project data including nodes, edges, terraform_files, cost_estimate, and `description` (mapped to `arch_description` in the response, matching the field name the frontend expects). Reuse existing `project_store` helpers.

## Frontend

### Right panel tab: `"templates"`

Add `"templates"` to the `RightPanelTab` union type in `useWorkspace.ts`.

### `useWorkspace.ts` changes

- New function `openTemplates()`: sets `rightPanelTab = "templates"`, `rightPanelOpen = true`
- Add `"templates"` to the `RightPanelTab` union type

### `useCanvasPipeline.ts` changes

New function `loadTemplateSnapshot(data: TemplateDetail)`:
  1. Call `hydrate(data.nodes, data.edges)` (already available from `useDiagramState`)
  2. Call `setTerraformFiles(data.terraform_files)` (internal setter, already in scope)
  3. Call `setCostEstimate(data.cost_estimate)` (internal setter, already in scope)
  4. Call `setArchDescription(data.arch_description)` (internal setter, already in scope)
  5. Call `applyLayout()` if node positions are invalid

Expose `loadTemplateSnapshot` in the return object so `page.tsx` can call `pipeline.loadTemplateSnapshot(data)`.

> **Why here and not in `useWorkspace`:** The `hydrate`, `setTerraformFiles`, `setCostEstimate`, and `setArchDescription` functions are all internal to `useCanvasPipeline`. Rather than exposing individual setters, we add one atomic "load snapshot" function.

### Template loading orchestration (in `page.tsx`)

The `loadTemplate(slug)` handler lives in `page.tsx` (where both `workspace` and `pipeline` are accessible):
  1. If `pipeline.nodes.length > 0` → show confirmation dialog (return early if cancelled)
  2. Call `fetchTemplateDetail(slug)` → get full template data
  3. Call `pipeline.loadTemplateSnapshot(data)` → hydrate canvas + set outputs
  4. If active project (`workspace.currentProject`): keep project context, state is now updated locally
  5. If no project: the canvas simply shows template content without a project association. This is the same visual state as when a user has nodes on canvas but hasn't saved yet. No new "unsaved design" concept is needed — the pipeline renders whatever nodes/edges are in its state regardless of whether a `currentProject` exists.

### `frontend/lib/templates.ts` additions

New type:

```typescript
export type TemplateDetail = {
  title: string;
  share_slug: string;
  thumbnail_url: string | null;
  nodes: Node[];
  edges: Edge[];
  terraform_files: { filename: string; content: string }[];
  cost_estimate: { monthly_total: number; breakdown: any[] } | null;
  arch_description: { sections: Record<string, any> } | null;
};
```

New function:

```typescript
export async function fetchTemplateDetail(slug: string): Promise<TemplateDetail>
// GET /api/templates/{slug}
```

### New component: `TemplatesPanel.tsx`

Location: `frontend/components/RightPanel/TemplatesPanel.tsx`

- Fetches templates on mount via `fetchTemplates()`
- Renders a vertical grid of `TemplateCard` components
- Loading state: skeleton cards
- Empty state: "No templates available" message
- Error state: "Failed to load templates" with retry

**Props:**
```typescript
{ onUseTemplate: (slug: string) => void }
```

### New component: `TemplateCard.tsx`

Location: `frontend/components/RightPanel/TemplateCard.tsx`

- Displays: title, category tags (derived from node categories in summary — or just title for MVP since summaries don't include nodes), optional thumbnail
- "Use" button that calls `onUseTemplate(slug)`

**Styling (per styleguide):**
- Card: `bg-gray-800/60 border border-gray-700/50 rounded-lg px-4 py-3`
- Hover: `hover:border-gray-600 transition-all duration-150`
- Title: `text-[15px] font-normal text-gray-200`
- "Use" button: `bg-blue-600 hover:bg-blue-500 text-white text-xs rounded px-2 py-1 active:scale-95`

### `RightPanel.tsx` changes

Add third tab case:
- `"templates"` → render `<TemplatesPanel onUseTemplate={onUseTemplate} />`
- Header shows "Templates" title

### `TopBar.tsx` changes

Wire existing "Templates" button to call `onTemplates()` prop (already exists, just needs real handler).

### `page.tsx` changes

- Replace toast stub in `onTemplates` handler with `workspace.openTemplates()`
- Pass `loadTemplate` handler down through RightPanel

### Confirmation dialog

When `loadTemplate()` is called and canvas has existing nodes:
- Show a confirmation dialog: "Discard current design? Loading this template will replace your current canvas."
- Confirm → proceed with template load
- Cancel → do nothing

Reuse the dialog pattern from `MyDesignsList` (inline confirmation or standard dialog component).

## Removals

- Remove template toast stub from `page.tsx` `onTemplates` handler
- Check `NewGenerationDialog.tsx` for any template-related flow and remove if present

## Data flow summary

```
TopBar "Templates" click
  → workspace.openTemplates()
  → RightPanel opens with tab="templates"
  → TemplatesPanel mounts, calls fetchTemplates()
  → Grid of TemplateCards rendered

TemplateCard "Use" click
  → onUseTemplate(slug) → workspace.loadTemplate(slug)
  → If nodes exist: confirmation dialog
  → fetchTemplateDetail(slug) → GET /api/templates/{slug}
  → hydrate(nodes, edges)
  → Set terraform/cost/description state
  → If active project: keep context
  → If no project: "unsaved design" state
```

## Out of scope

- Template search/filter
- Template previews (hover to see diagram)
- Creating templates from existing designs
- Template categories/tags in the card (requires backend changes to include node data in list endpoint)
