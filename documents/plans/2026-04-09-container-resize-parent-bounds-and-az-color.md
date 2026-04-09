# Container Resize Parent Bounds And AZ Color Plan

## Goal

Prevent nested canvas containers from expanding outside their parent bounds while preserving child-aware minimum sizing, and change Availability Zone container styling from indigo to red.

## Problem Summary

- Nested containers can be resized beyond the visual box of their parent container.
- Containers already refuse to shrink smaller than their children, which is correct.
- Availability Zone containers currently use an indigo accent, but product wants them red.

## Root Cause

- The canvas only computes and passes `minWidth` and `minHeight` into the container resizer.
- Nested containment metadata (`parentId` + `extent: "parent"`) constrains dragging, not resizing.
- There is no parent-aware maximum size calculation for nested containers.
- AZ color comes from the shared container color map and matching style tests/docs.

## Scope

### Code

- `frontend/components/Canvas/containerInteractions.ts`
- `frontend/components/Canvas/useCanvasInteractions.ts`
- `frontend/components/Canvas/ContainerNode.tsx`
- `frontend/components/Canvas/containerInteractions.test.ts`
- `frontend/components/Canvas/containerNodeStyles.test.ts`
- `frontend/lib/categoryColors.ts`

### Docs

- `documents/platform-docs.md`
- `documents/styleguide.md`

## Implementation Plan

1. Add parent-bound resize constraint helpers in `containerInteractions.ts`.
2. Compute full resize constraints for each container in `useCanvasInteractions.ts`.
3. Pass min/max resize props into `NodeResizer` from `ContainerNode.tsx`.
4. Keep root containers unrestricted while clamping nested containers to parent bounds.
5. Update AZ container color in the shared container color map.
6. Update tests and docs to match the new behavior.

## TDD Slices

1. RED: add a unit test proving a nested container's maximum width and height are capped by the remaining space inside its parent.
   GREEN: implement a helper that derives parent-aware max bounds from the child position and parent size.

2. RED: add a unit test proving nested containers still report the same child-aware minimum width and height as before.
   GREEN: combine the new max-bound helper with the existing min-size logic without changing shrink behavior.

3. RED: add a component/unit test proving the container resizer receives both min and max bounds for nested containers while root containers remain effectively unbounded.
   GREEN: thread the computed constraints through `useCanvasInteractions.ts` into `ContainerNode.tsx`.

4. RED: update style tests to expect Availability Zone containers to use the red container accent.
   GREEN: change the AZ entry in `frontend/lib/categoryColors.ts` and keep style generation consistent.

5. RED: documentation review shows canvas behavior and container palette are stale.
   GREEN: update `documents/platform-docs.md` and `documents/styleguide.md` to describe parent-clamped nested resizing and the AZ red color.

## Acceptance Criteria

- Nested containers cannot be resized beyond the visible bounds of their current parent.
- Nested containers still cannot shrink smaller than the space required by their children.
- Root containers can still expand freely on the canvas.
- Availability Zone containers render in red everywhere the shared container color map is used.
- Updated tests cover the new resize constraints and color expectations.
- Canvas and style documentation match shipped behavior.
