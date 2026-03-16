# Plan: Selection-Aware Chat (Issue #21)

## Summary

When nodes are selected on the canvas, show Copilot-style context chips above the chat input (dismissible, with category color dots), and include `selected_node_ids` in the WebSocket chat payload so the backend chat agent scopes its responses to those nodes.

## Current State

- `useDiagramState.ts:148` already derives `selectedNodeIds` from `nodes.filter(n => n.selected)`
- `useCanvasPipeline.ts` spreads `...diagram` (which includes `selectedNodeIds`) into its return value
- `Chat.tsx` has no selection awareness — `onSend` is `(message: string) => void`
- `handleSend` in `useCanvasPipeline.ts:982` sends `{ type: "chat", message, project_id }` — no selection data
- Backend `chat_agent.py:106` builds a system prompt with full architecture context but no selection scoping
- `ws_handler.py:300-436` handles `chat` messages and calls `stream_chat_reply` — doesn't pass selection
- `SelectionInfoBar.tsx` already uses the glass-surface styling pattern we'll reuse

## Design Decisions

1. **Copilot-style chips** — Each selected node is an individual dismissible chip (×, color dot, label) above the chat text input, inside the same input container. Inspired by the Copilot file-context UI.
2. **Pass `selectedNodeIds` at send time** — The `onSend` callback becomes `(message: string, selectedNodeIds: string[])`. The pipeline hook reads current selection and includes it in the WS payload.
3. **Backend prompt augmentation** — When `selected_node_ids` is non-empty, append a focused-context section to the chat agent's system prompt listing the selected nodes and instructing the agent to scope responses to them.
4. **Deselect via chip ×** — Clicking × on a chip deselects that node on the canvas by setting `selected: false` on the React Flow node. New `deselectNode(id)` function in `useDiagramState`.
5. **No selection = full context** — Empty/absent `selected_node_ids` means the agent uses the full architecture context (existing behavior, zero change).

## Steps

### Step 1: Add `deselectNode` to `useDiagramState`

**File:** `frontend/lib/useDiagramState.ts`

- Add a `deselectNode(id: string)` callback that sets `selected: false` on the matching node via `setNodes`
- Expose it in the return object alongside `selectedNodeIds`

```typescript
const deselectNode = useCallback((id: string) => {
  setNodes((prev) => prev.map((n) => n.id === id ? { ...n, selected: false } : n));
}, []);
```

### Step 2: Create `ChatSelectionChips` component

**File:** `frontend/components/ChatSelectionChips.tsx` (new)

- Receives `selectedNodes: Array<{ id: string; label: string; category: string }>` and `onDeselect: (id: string) => void`
- Renders a flex-wrap row of chips, each with:
  - `×` button calling `onDeselect(id)`
  - Colored dot via `colorForCategory(category)` from `@/lib/categoryColors`
  - Node label text
- Hidden when `selectedNodes` is empty
- Styling: chips use `bg-white/10 border border-white/10 rounded-md px-2 py-0.5 text-xs text-gray-200` with a small colored dot (`w-2 h-2 rounded-full`)
- Row container: `flex flex-wrap gap-1.5 px-4 py-2 border-b border-gray-700`

### Step 3: Add selection chips to `Chat.tsx`

**File:** `frontend/components/Chat.tsx`

- Add new props to `ChatProps`:
  - `selectedNodes?: Array<{ id: string; label: string; category: string }>`
  - `onDeselectNode?: (id: string) => void`
- Import and render `<ChatSelectionChips>` above the input form (inside the input area, between the messages list and the form)
- Only show when `selectedNodes` is non-empty and not `readOnly`

### Step 4: Thread selection data through `useCanvasPipeline`

**File:** `frontend/lib/useCanvasPipeline.ts`

- `useDiagramState()` already returns `selectedNodeIds` (and now `deselectNode` from Step 1)
- Derive `selectedNodes` (with labels + categories) from `diagram.nodes` and `diagram.selectedNodeIds`:
  ```typescript
  const selectedNodes = useMemo(() =>
    diagram.selectedNodeIds.map((id) => {
      const node = diagram.nodes.find((n) => n.id === id);
      return {
        id,
        label: node?.data?.label ?? id,
        category: node?.data?.category ?? "default",
      };
    }),
    [diagram.selectedNodeIds, diagram.nodes]
  );
  ```
- Update `handleSend` to include `selected_node_ids` in the WS payload:
  ```typescript
  function handleSend(message: string) {
    if (!chatEnabled) return;
    // ... existing message state updates ...
    const currentSelectedIds = diagram.selectedNodeIds;
    void (async () => {
      const payload = await withAccessToken({
        type: "chat",
        message,
        project_id: projectId ?? undefined,
        ...(currentSelectedIds.length > 0 ? { selected_node_ids: currentSelectedIds } : {}),
      });
      wsClient.send(payload);
    })();
  }
  ```
- Expose `selectedNodes` and `deselectNode` in the return object

### Step 5: Wire Chat props in page components

**File:** `frontend/app/new/page.tsx`

- Pass `selectedNodes` and `onDeselectNode` to `<Chat>`:
  ```tsx
  <Chat
    onSend={handleSend}
    messages={messages}
    disabled={!chatEnabled}
    isTyping={isChatStreaming}
    disabledReason={chatDisabledReason}
    selectedNodes={selectedNodes}
    onDeselectNode={deselectNode}
    onAcceptAndGenerate={isDiscoveryMode ? () => { void triggerGeneration(); } : undefined}
  />
  ```

**File:** `frontend/app/p/[slug]/project-by-slug-client.tsx`

- Same: pass `selectedNodes` and `onDeselectNode` to `<Chat>`
- For `readOnly` viewers, selection chips won't render (guarded in Step 3)

### Step 6: Backend — Extract `selected_node_ids` in WS handler

**File:** `backend/ws_handler.py`

- In the `chat` message handler (line ~300), extract `selected_node_ids` from the payload:
  ```python
  selected_node_ids = data.get("selected_node_ids") or []
  if not isinstance(selected_node_ids, list):
      selected_node_ids = []
  ```
- Pass it to `stream_chat_reply`:
  ```python
  async for chunk in stream_chat_reply(
      user_message, prior_history, project_row,
      selected_node_ids=selected_node_ids,
  ):
  ```

### Step 7: Backend — Augment chat agent system prompt with selection context

**File:** `backend/agents/chat_agent.py`

- Add a `_summarize_selection` helper:
  ```python
  def _summarize_selection(nodes: Any, selected_ids: list[str]) -> str:
      if not selected_ids or not isinstance(nodes, list):
          return ""
      lines = []
      for node in nodes:
          if not isinstance(node, dict):
              continue
          node_id = str(node.get("id", ""))
          if node_id not in selected_ids:
              continue
          data = node.get("data") if isinstance(node.get("data"), dict) else {}
          label = str(data.get("label", node_id))
          category = str(data.get("category", "unknown"))
          lines.append(f"- {label} (id={node_id}, category={category})")
      if not lines:
          return ""
      return (
          "\n\nSELECTED NODES (user is focused on these):\n"
          + "\n".join(lines)
          + "\n\nWhen the user says \"this\", \"these\", or \"selected\", they mean the nodes above. "
          "Scope your answer to these nodes unless the question clearly requires broader context."
      )
  ```

- Update `build_chat_system_prompt` signature to accept `selected_node_ids`:
  ```python
  def build_chat_system_prompt(
      project_state: dict[str, Any],
      selected_node_ids: list[str] | None = None,
  ) -> str:
  ```

- Append `_summarize_selection(project_state.get("nodes"), selected_node_ids or [])` to the system prompt string

- Update `stream_chat_reply` to accept and forward `selected_node_ids`:
  ```python
  async def stream_chat_reply(
      question: str,
      history: list[dict[str, Any]],
      project_state: dict[str, Any],
      selected_node_ids: list[str] | None = None,
  ) -> AsyncGenerator[str, None]:
      ...
      system_prompt = build_chat_system_prompt(project_state, selected_node_ids)
  ```

### Step 8: Update `documents/data-reference.md`

- Document the new `selected_node_ids` field on the `chat` WS message type
- Add a section describing the selection context behavior (when present → scoped, when absent → full context)

## Files Changed

| File | Change Type |
|------|-------------|
| `frontend/lib/useDiagramState.ts` | Add `deselectNode` function |
| `frontend/components/ChatSelectionChips.tsx` | **New** — chip row component |
| `frontend/components/Chat.tsx` | Add `selectedNodes` + `onDeselectNode` props, render chips |
| `frontend/lib/useCanvasPipeline.ts` | Derive `selectedNodes`, add `selected_node_ids` to WS payload, expose new fields |
| `frontend/app/new/page.tsx` | Pass selection props to Chat |
| `frontend/app/p/[slug]/project-by-slug-client.tsx` | Pass selection props to Chat |
| `backend/ws_handler.py` | Extract `selected_node_ids`, pass to agent |
| `backend/agents/chat_agent.py` | Add `_summarize_selection`, augment system prompt |
| `documents/data-reference.md` | Document new WS field |

## Out of Scope

- Scoped diagram modifications (agent emitting add/remove events for selected nodes) — future ticket
- Clear selection on apply — future ticket (depends on scoped modifications)
- Discovery mode selection awareness (no canvas exists during discovery)
