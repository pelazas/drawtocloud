# Templates in Right Panel — Design Spec

**Issue:** [#101](https://github.com/pelazas/drawtocloud/issues/101)
**Date:** 2026-03-24

## Overview

Move template browsing into the collapsible right panel. Users click "Templates" in the TopBar, browse a grid of template cards, and click one to load it onto the canvas in-place (replacing current nodes/edges).

## Backend

### New endpoint: `GET /api/templates/{slug}`

Returns full template data for a single template. Public (no auth required).

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

**Error responses:**
- `404` — template not found

**Implementation:** Query Supabase for projects where `is_template = True` and `share_slug = {slug}`. Return full project data. Reuse existing `project_store` helpers.

## Frontend

### Right panel tab: `"templates"`

Add `"templates"` to the `RightPanelTab` union type in `useWorkspace.ts`.

### `useWorkspace.ts` changes

- New function `openTemplates()`: sets `rightPanelTab = "templates"`, `rightPanelOpen = true`
- New function `loadTemplate(slug: string)`:
  1. If canvas has nodes → show confirmation dialog (return early if cancelled)
  2. Call `fetchTemplateDetail(slug)`
  3. Call `hydrate(nodes, edges)` on diagram state
  4. Set terraform files, cost estimate, arch description from response
  5. If active project: keep project context, update local state
  6. If no project: enter "unsaved design" state with template content

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
