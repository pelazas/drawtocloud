# Plan: Canvas Node Selection & Multi-Select (Issue #20)

## Summary

Add single-select, multi-select (Shift+click & drag), Delete key removal, selection info bar, and expose `selectedNodeIds` — all using React Flow's built-in selection APIs plus styleguide-compliant visual feedback.

## Current State

- React Flow already has `elementsSelectable={!readOnly}` enabled
- ContainerNode shows blue border when selected; ServiceNode has NO selection styling
- Selection state lives inside React Flow's internal state (via `node.selected`)
- `useDiagramState` applies `onNodesChange` / `onEdgesChange` from React Flow
- Canvas edits (remove_node) are sent via WebSocket and trigger Terraform regen

## Design Decisions

1. **Use React Flow's built-in selection** — no custom selection state needed. React Flow already tracks `node.selected` via `onNodesChange` (selection changes come as `NodeChange[]`). Multi-select with Shift+click and drag-select box work out of the box with `selectionOnDrag`.
2. **Derive `selectedNodeIds`** from `nodes.filter(n => n.selected)` rather than maintaining a parallel array.
3. **Selection info bar** as a glass-surface overlay on the canvas (like minimap positioning pattern).
4. **Batch delete** sends one `canvas_edit` per removed node (backend already handles sequential edits).

## Steps

### Step 1: Add selection visual feedback to ServiceNode

**File:** `frontend/components/Canvas/ServiceNode.tsx`

- Accept `selected` prop (React Flow passes it automatically to custom nodes)
- When selected, add blue glow border using styleguide tokens:
  - `ring-2 ring-blue-500/50` or box-shadow: `0 0 0 2px rgba(59,130,246,0.5)`
  - Transition for smooth select/deselect

### Step 2: Improve ContainerNode selection styling

**File:** `frontend/components/Canvas/ContainerNode.tsx`

- Add glow effect matching ServiceNode (currently just changes border color)
- Use same blue glow shadow for consistency

### Step 3: Enable multi-select features on Canvas

**File:** `frontend/components/Canvas.tsx`

- Add `selectionOnDrag` prop to enable drag-select box
- Add `multiSelectionKeyCode="Shift"` (React Flow default, but be explicit)
- Add `deleteKeyCode={null}` — we'll handle delete ourselves for more control
- Add `selectionMode={SelectionMode.Partial}` so nodes partially inside the box get selected

### Step 4: Add keyboard delete handler

**File:** `frontend/components/Canvas.tsx` (or a new `useCanvasKeyboard.ts` hook if logic exceeds ~30 lines)

- Listen for Delete/Backspace key when canvas is focused
- Get selected nodes from `nodes.filter(n => n.selected)`
- For each selected node, send `canvas_edit` remove_node message via WebSocket
- Remove nodes and their connected edges from local state immediately (optimistic)
- Only trigger when canvas has focus (not when typing in chat)

### Step 5: Create SelectionInfoBar component

**File:** `frontend/components/Canvas/SelectionInfoBar.tsx`

- Glass surface overlay positioned at bottom-center of canvas
- Shows: `"{n} items selected"` + trash icon button
- Trash button triggers same delete logic as keyboard Delete
- Only visible when `selectedNodeIds.length > 0`
- Animate in/out with opacity transition
- Styled per styleguide glass pattern: `bg-black/30 backdrop-blur-md border border-white/5 rounded-xl`

### Step 6: Expose selectedNodeIds

**File:** `frontend/lib/useDiagramState.ts`

- Add computed `selectedNodeIds` derived from nodes state: `nodes.filter(n => n.selected).map(n => n.id)`
- Export from the hook return value
- This makes it available to parent page for T12 (chat context)

### Step 7: Wire everything together in page

**File:** `frontend/app/new/page.tsx`

- Pass `selectedNodeIds` where needed
- Pass delete handler to Canvas (for SelectionInfoBar)
- Ensure `readOnly` mode disables selection features

## Testing Strategy

- Visual: verify blue glow appears on single-click, multi-select via Shift+click and drag
- Keyboard: Delete key removes selected nodes
- Edge cleanup: deleting a node removes its connected edges
- Deselect: clicking empty canvas clears selection
- ReadOnly mode: selection disabled when `readOnly=true`

## Files Changed

| File | Change |
|------|--------|
| `frontend/components/Canvas/ServiceNode.tsx` | Add selected glow styling |
| `frontend/components/Canvas/ContainerNode.tsx` | Improve selected glow styling |
| `frontend/components/Canvas.tsx` | Enable multi-select, wire delete handler, render SelectionInfoBar |
| `frontend/components/Canvas/SelectionInfoBar.tsx` | **New** — selection count + delete button overlay |
| `frontend/lib/useDiagramState.ts` | Export `selectedNodeIds` |
| `frontend/app/new/page.tsx` | Wire selectedNodeIds and delete handler |
