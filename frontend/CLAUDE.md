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
  new/page.tsx      # new generation page — PreGenForm + canvas layout
  layout.tsx
components/
  ApiKeyModal/
    index.tsx         # BYOK settings modal UI
    useApiKeyModal.ts # BYOK modal state + save/delete/fetch logic
  PreGenForm/
    index.tsx           # single-screen form; onSubmit(answers, mode)
    usePreGenForm.ts    # form state, validation, buildAnswers()
    RegionSelector.tsx      # timezone-aware multi-region selector with recommendations
    ScaleResilience.tsx     # groups expected-users and uptime cards
    ExpectedUsersCards.tsx  # t-shirt sizing cards mapped to backend ranges
    UptimeCards.tsx         # SLA cards with downtime + cost tooltip
    BudgetInput.tsx         # optional monthly budget with min-$5 validation
    AdvancedOptions.tsx       # collapsible Compliance / Environment / Compute
    AiPromptHelper.tsx        # collapsible AI prompt + paste-back
  Chat.tsx          # chat panel; renders "Accept & Generate" button on plan_ready messages
  Canvas.tsx        # React Flow diagram
  OutputPanel.tsx   # Terraform + cost tabs
lib/
  llmKeys.ts          # BYOK REST helpers: save/get/delete key status
  websocket.ts      # WS singleton
  projects.ts       # CanvasSession type (modes: "new" | "chat_first" | "existing")
  useCanvasPipeline.ts  # all WS/pipeline state; exports triggerGeneration, isDiscoveryMode
  categoryColors.ts # node category → Tailwind color
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
- Any add / remove / rename node triggers **full Terraform regeneration** (no surgical diff in MVP)
- `nodeCounter` is a module-level `let` in `page.tsx` — reset on hot reload, acceptable for MVP

## Dev
```bash
cd frontend && pnpm dev
```
