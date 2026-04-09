import type { Node, NodeChange } from "reactflow";

export type ManualPositionOverrides = Record<string, { x: number; y: number }>;

type SplitManualPositionChangesResult = {
  graphChanges: NodeChange[];
  positionOverrides: ManualPositionOverrides;
};

export function splitManualPositionChanges(changes: NodeChange[]): SplitManualPositionChangesResult {
  const graphChanges: NodeChange[] = [];
  const positionOverrides: ManualPositionOverrides = {};

  for (const change of changes) {
    if (change.type === "position" && change.position) {
      positionOverrides[change.id] = change.position;
      continue;
    }

    graphChanges.push(change);
  }

  return { graphChanges, positionOverrides };
}

export function applyManualPositionOverrides(nodes: Node[], overrides: ManualPositionOverrides): Node[] {
  return nodes.map((node) => {
    const override = overrides[node.id];
    if (!override) return node;
    return {
      ...node,
      position: override,
    };
  });
}

export function clearManualPositionOverrides(): ManualPositionOverrides {
  return {};
}
