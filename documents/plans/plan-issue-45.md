# Plan: Issue #45 — Pre-connect WebSocket to eliminate canvas startup delay

## Problem

When the user submits the pre-gen form, there's a 2-3s delay before anything appears on the canvas. The WebSocket handshake only starts when `appState` switches to `"canvas"` (`useCanvasPipeline.ts:268`), meaning the user waits for: WS handshake + HTTP POST + backend startup.

## Root Cause

In `useCanvasPipeline.ts`, `wsClient.connect()` is inside an effect guarded by `appState === "canvas"`. Since `page.tsx` starts with `appState = "pre_gen"`, no WS connection happens during the form phase.

## Fix

**Add a single `useEffect` in `frontend/app/new/page.tsx`** that calls `wsClient.connect()` on mount (during the pre-gen form phase). By the time the user fills in the form and clicks "Generate", the WS handshake is already complete.

### Why this is safe
- `websocket.ts:20-26` already guards against duplicate connections: if the socket is `OPEN` or `CONNECTING`, `connect()` is a no-op
- The existing `connect()` call in `useCanvasPipeline.ts:268` remains as a fallback — if the user navigates directly to canvas view, it still works
- No changes needed to `websocket.ts` itself

### Steps

1. **`frontend/app/new/page.tsx`** — Add a `useEffect` near the top of `NewGenerationPage` that imports `wsClient` and calls `wsClient.connect()` on mount:
   ```ts
   import wsClient from "@/lib/websocket";

   // Inside component, after hooks:
   useEffect(() => {
     wsClient.connect();
   }, []);
   ```

2. **No other files need changes.** The guard in `websocket.ts:20-26` prevents double connections, and `useCanvasPipeline.ts:268` remains as-is for safety.

### What NOT to do
- Don't remove the `wsClient.connect()` call from `useCanvasPipeline.ts` — it's the fallback for direct canvas navigation
- Don't add reconnect/disconnect logic here — the singleton handles lifecycle
- Don't add loading states — the WS connects silently in the background

## Testing

- Manual: open `/new`, check browser DevTools Network tab → WS connection should appear immediately on page load, not after form submission
- Verify no regressions: submit form → canvas should still work normally
- Verify existing project loads still work (existing `connect()` call untouched)

## Scope

- 1 file changed: `frontend/app/new/page.tsx`
- ~3 lines added
- No backend changes
