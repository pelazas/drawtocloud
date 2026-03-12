# Frontend — DrawToCloud

Next.js 14 (App Router), Tailwind CSS, React Flow 11.

## Stack
- **Framework:** Next.js 14 App Router
- **Styling:** Tailwind CSS
- **Diagram:** React Flow 11
- **Package manager:** pnpm
- **WS client:** `frontend/lib/websocket.ts` — reads `NEXT_PUBLIC_WS_URL`

## Component Rules
- **Max 150 lines per component.** If a component exceeds this, split it into smaller components automatically.
- **Always separate UI from logic.** Keep rendering in the component file; move state, effects, and handlers into a co-located `use<Name>.ts` hook.
- Place shared color logic in `frontend/lib/categoryColors.ts` — import `colorForCategory` from there, never inline it.

## Key Files
```
app/
  page.tsx          # main layout — composes top-level panels only
  layout.tsx
components/
  ApiKeyModal.tsx   # shown on first load, cannot be skipped
  Chat.tsx          # chat panel
  Canvas.tsx        # React Flow diagram
  OutputPanel.tsx   # Terraform + cost tabs
  SettingsIcon.tsx  # update API key
lib/
  websocket.ts      # WS singleton
  storage.ts        # localStorage helpers
  categoryColors.ts # node category → Tailwind color
```

## API Key Flow
- Stored in `localStorage` only — never sent to our backend directly
- Injected into every WS message payload: `{ api_key, provider, ... }`
- Settings icon allows updating at any time
- Modal cannot be skipped on first load

## Node Category Colors
| Category    | Color  |
|-------------|--------|
| network     | blue   |
| compute     | orange |
| database    | green  |
| storage     | yellow |
| security    | red    |
| monitoring  | purple |

## Canvas Editing
- Any add / remove / rename node triggers **full Terraform regeneration** (no surgical diff in MVP)
- `nodeCounter` is a module-level `let` in `page.tsx` — reset on hot reload, acceptable for MVP

## Dev
```bash
cd frontend && pnpm dev
```
