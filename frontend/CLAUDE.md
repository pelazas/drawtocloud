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
  page.tsx          # single-route workspace layout (TopBar + LeftPanel + Canvas + RightPanel)
  login/page.tsx    # Google-only sign-in page
  layout.tsx
components/
  LeftPanel.tsx     # chat panel wrapper
  RightPanel.tsx    # collapsible output / my-designs panel
  RightPanel/
    MyDesignsList.tsx  # project list + delete confirmation
  Chat.tsx          # chat panel; renders "Accept & Generate" button on plan_ready messages
  Canvas.tsx        # React Flow diagram + cost overlay badge
  TopBar.tsx        # workspace actions + auth controls
  OutputPanel.tsx   # Terraform + cost tabs (fills RightPanel container)
lib/
  websocket.ts         # WS singleton
  projects.ts          # persisted project mapping + types
  projectActions.ts    # reusable project delete hook
  useWorkspace.ts      # workspace-level auth/project/panel orchestration
  useCanvasPipeline.ts # WS/pipeline state + canvas/chat handlers
  categoryColors.ts    # node category → Tailwind color
  domains.ts           # app-domain and auth-route helpers
middleware.ts          # app-domain auth middleware + legacy /p/:slug redirect
```

## Auth Flow
- Auth is via Supabase `access_token` — included in every WS message and API call
- Users manage BYOK credentials through `ApiKeyModal`; frontend calls `/api/llm-key` endpoints via `lib/llmKeys.ts`
- Frontend never stores plaintext provider keys in localStorage
- WS messages do NOT carry `api_key` or `provider` fields

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
- Structural architecture changes happen through chat plans, not direct canvas drag/delete interactions
- Visual container resize is local to the diagram UI and does not trigger Terraform regeneration

## Dev
```bash
cd frontend && pnpm dev
```
