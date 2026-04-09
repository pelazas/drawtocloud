import type { Node, NodeChange } from "reactflow";
import { applyNodeChanges } from "reactflow";

import {
  applyManualPositionOverrides,
  clearManualPositionOverrides,
  type ManualPositionOverrides,
  splitManualPositionChanges,
} from "./manualNodePositions";

type DiagramPresentationResult = {
  canonicalNodes: Node[];
  renderedNodes: Node[];
  manualPositionOverrides: ManualPositionOverrides;
};

export function applyDiagramNodeChanges(
  canonicalNodes: Node[],
  changes: NodeChange[],
  currentOverrides: ManualPositionOverrides
): DiagramPresentationResult {
  const { graphChanges, positionOverrides } = splitManualPositionChanges(changes);
  const nextCanonicalNodes = applyNodeChanges(graphChanges, canonicalNodes);
  const nextOverrides = { ...currentOverrides, ...positionOverrides };

  return {
    canonicalNodes: nextCanonicalNodes,
    renderedNodes: applyManualPositionOverrides(nextCanonicalNodes, nextOverrides),
    manualPositionOverrides: nextOverrides,
  };
}

export function replaceDiagramNodes(canonicalNodes: Node[]): DiagramPresentationResult {
  return {
    canonicalNodes,
    renderedNodes: canonicalNodes,
    manualPositionOverrides: clearManualPositionOverrides(),
  };
}
