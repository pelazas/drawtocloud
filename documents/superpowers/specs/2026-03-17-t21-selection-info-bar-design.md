# T21 Selection Info Bar — Remove Trash Icon (Issue #53)

## Goal
Remove the destructive trash icon from the "X items selected" popup while keeping selection count visibility and existing keyboard-based delete behavior.

## Current Behavior
- Selection bar shows count text and a trash button that triggers `onDelete` in `SelectionInfoBar`.
- Keyboard Delete/Backspace already mapped via `deleteKeyCode` in `Canvas` to `onDeleteNodes`.

## Requirements
- Remove the trash button; no replacement UI.
- Preserve selection count text.
- Keep keyboard Delete/Backspace deletion flow unchanged.
- Avoid visual regressions for desktop and mobile; styling of bar stays consistent minus the button.

## Proposed Design
- Update `SelectionInfoBar` to render only the count text; remove button markup and related props except the count.
- Adjust props to drop `onDelete` (not needed after button removal) and update call sites accordingly (`Canvas.tsx`).
- Keep container styles unchanged to minimize layout impact; ensure horizontal spacing still looks balanced once the button is gone (may reduce gap if present).
- No new interactions; retain existing React Flow delete keyboard handling.

## Testing
- Manual: select multiple nodes on canvas; verify popup shows count only; ensure Delete/Backspace still removes nodes.
- Automated: run existing frontend lint/type checks (pnpm lint) to guard regressions.
