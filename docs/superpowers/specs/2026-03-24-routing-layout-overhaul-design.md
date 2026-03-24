# Design: Routing & Single-Page Layout Overhaul

**Issue:** #97 — Part of Epic #93 (UX/Architecture Refactor)
**Date:** 2026-03-24

## Goal

Replace the multi-route app (dashboard → pre-gen form → discovery → project viewer) with a single `/` route containing a 3-panel workspace. Unauthenticated users see a read-only canvas; auth gates actions, not pages.

## Layout

```
+---------------------------------------------------------------------+
| TopBar                                                              |
+---------------+-------------------------------------+---------------+
| LeftPanel     | Canvas (flex-1)                     | RightPanel    |
| (w-80, fixed) |                                     | (w-80, coll.) |
|               |                        +----------+ |               |
| Chat.tsx      |                        | cost     | | Content swaps |
|               |                        | overlay  | | by context    |
|               |                        +----------+ |               |
| input area    |                                     | [X close]     |
+---------------+-------------------------------------+---------------+
```

## Components

### `app/page.tsx`
Layout glue only (~50 lines). Renders `<TopBar>`, `<LeftPanel>`, `<Canvas>`, `<RightPanel>`. Delegates all state to `useWorkspace`.

### `components/TopBar.tsx` (rewrite)
- "Describe your app" button (placeholder — future issue)
- "Templates" button (placeholder — opens right panel to templates, future issue)
- "My Designs" button (opens right panel to project list)
- "Auto Layout" button (placeholder)
- "Generate Terraform" button (auth-gated)
- User avatar / "Sign In" button (right side)

### `components/LeftPanel.tsx` (new)
Fixed width `w-80`. Contains:
- `Chat.tsx` (existing component, reused)
- "Start from scratch" button

### `components/RightPanel.tsx` (new)
Collapsible panel, `w-80`. Slides in/out with `translate-x` + `transition-transform duration-300`. Content switches between:
- **Terraform/Cost/Description** — OutputPanel content when a project is loaded
- **My Designs** — project list (extracted from old dashboard)
- Header with title + close button `[X]`

### `lib/useWorkspace.ts` (new)
Top-level hook consolidating:
- Auth state (Supabase)
- Current project loading (from `?project=slug` query param or last used)
- Canvas session state (nodes, edges, files, cost)
- WebSocket connection management
- Right panel state (open/closed, active tab)
- `requireAuth(action)` helper — if unauth, redirects to `/login?next=/`

### `components/Canvas.tsx` (minor change)
- Cost overlay: absolute-positioned `$X/mo` badge in top-right of canvas container
- `readOnly={!user}` for unauthenticated visitors

### `components/Chat.tsx` (minor change)
- When unauth: input disabled, placeholder says "Sign in to start designing"

## Auth Gating

Auth moves from route-level to action-level:
- **Canvas:** renders for everyone. Pan/zoom works. Editing (drag, delete, rename) requires auth (`readOnly={!user}`).
- **Chat:** visible but input disabled for unauth users.
- **TopBar actions:** "Generate Terraform", etc. call `requireAuth()` which redirects to `/login?next=/`.
- **Right panel:** "My Designs" requires auth (redirects if not signed in).

## Routing Changes

| Before | After |
|--------|-------|
| `/` — Dashboard | `/` — 3-panel workspace |
| `/new` — Pre-gen form | Removed |
| `/new/discovery` — Discovery chat | Removed (merged into `/`) |
| `/p/[slug]` — Shared project viewer | Removed — `/?project=slug` |
| `/login` — Email + OAuth | `/login` — Google-only |
| `/register` — Registration | Removed |

## Middleware

- `/` is public (unauth users see read-only canvas)
- `/login` and `/auth/callback` remain public
- All other routes redirect to `/`

## `/login` Page

Simplified to centered card:
- DrawToCloud logo
- "Sign in with Google" button (Supabase OAuth)
- No email/password, no registration link

## Files to Delete

- `frontend/app/new/` (entire directory)
- `frontend/app/register/` (entire directory)
- `frontend/app/p/` (entire directory)
- `frontend/components/PreGenForm/` (entire directory)
- `frontend/components/ProjectsDashboard.tsx`
- `frontend/components/NewGenerationDialog.tsx`

## Files to Create

- `frontend/components/LeftPanel.tsx`
- `frontend/components/RightPanel.tsx`
- `frontend/lib/useWorkspace.ts`

## Files to Modify

- `frontend/app/page.tsx` — full rewrite to 3-panel layout
- `frontend/app/login/page.tsx` — simplify to Google-only
- `frontend/components/TopBar.tsx` — rewrite with new action buttons
- `frontend/components/Chat.tsx` — add unauth disabled state
- `frontend/components/Canvas.tsx` — add cost overlay
- `frontend/middleware.ts` — make `/` public, simplify rules

## Style Compliance

All new components follow `documents/styleguide.md`:
- Page bg: `bg-gray-950`, Panel bg: `bg-gray-900`
- Borders: `border-gray-700/800`
- Text: `text-white`, `text-gray-400`
- Buttons: `bg-blue-600 hover:bg-blue-500`
- Transitions: `transition-transform duration-300`
- Font: Geist Sans (inherited from layout)
