import type { Node } from "reactflow";

import { normalizeContainerType } from "./containerNodeStyles";

const MIN_CONTAINER_WIDTH = 300;
const MIN_CONTAINER_HEIGHT = 200;
const CONTAINER_PADDING = 40;
const SERVICE_WIDTH = 120;
const SERVICE_HEIGHT = 80;

type Size = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };
type ContainerScope = ReturnType<typeof normalizeContainerType>;

function getContainerScope(node: Node | null | undefined): ContainerScope | null {
  if (!node || node.type !== "container") return null;
  return normalizeContainerType(node.data?.containerType);
}

function getNodeSize(node: Node): Size {
  if (node.type === "container") {
    return {
      width: typeof node.style?.width === "number" ? node.style.width : MIN_CONTAINER_WIDTH,
      height: typeof node.style?.height === "number" ? node.style.height : MIN_CONTAINER_HEIGHT,
    };
  }

  return { width: SERVICE_WIDTH, height: SERVICE_HEIGHT };
}

function getNodeMap(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function getAbsolutePosition(node: Node, nodeMap: Map<string, Node>): { x: number; y: number } {
  let x = Number.isFinite(node.position?.x) ? Number(node.position.x) : 0;
  let y = Number.isFinite(node.position?.y) ? Number(node.position.y) : 0;
  let currentParent = typeof node.parentId === "string" ? node.parentId : null;

  while (currentParent) {
    const parent = nodeMap.get(currentParent);
    if (!parent) break;
    x += Number.isFinite(parent.position?.x) ? Number(parent.position.x) : 0;
    y += Number.isFinite(parent.position?.y) ? Number(parent.position.y) : 0;
    currentParent = typeof parent.parentId === "string" ? parent.parentId : null;
  }

  return { x, y };
}

export function getAbsoluteNodePosition(node: Node, nodes: Node[]): { x: number; y: number } {
  return getAbsolutePosition(node, getNodeMap(nodes));
}

function getNodeRect(node: Node, nodeMap: Map<string, Node>): Rect {
  const position = getAbsolutePosition(node, nodeMap);
  const size = getNodeSize(node);
  return { ...position, ...size };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeDepth(node: Node, nodeMap: Map<string, Node>): number {
  let depth = 0;
  let currentParent = typeof node.parentId === "string" ? node.parentId : null;
  while (currentParent) {
    const parent = nodeMap.get(currentParent);
    if (!parent) break;
    depth += 1;
    currentParent = typeof parent.parentId === "string" ? parent.parentId : null;
  }
  return depth;
}

function isPointInsideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function getContainerMinSize(container: Node, nodes: Node[]): Size {
  const children = nodes.filter((node) => node.parentId === container.id);
  if (children.length === 0) {
    return { width: MIN_CONTAINER_WIDTH, height: MIN_CONTAINER_HEIGHT };
  }

  let maxX = 0;
  let maxY = 0;

  for (const child of children) {
    const size = getNodeSize(child);
    const x = Number.isFinite(child.position?.x) ? Number(child.position.x) : 0;
    const y = Number.isFinite(child.position?.y) ? Number(child.position.y) : 0;
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  }

  return {
    width: Math.max(MIN_CONTAINER_WIDTH, maxX + CONTAINER_PADDING),
    height: Math.max(MIN_CONTAINER_HEIGHT, maxY + CONTAINER_PADDING),
  };
}

export function isValidContainerParent(
  childScope: ContainerScope,
  parentScope: ContainerScope | null,
  isMultiRegion: boolean
): boolean {
  if (childScope === "region") return parentScope === null;
  if (childScope === "vpc") return parentScope === null || (isMultiRegion && parentScope === "region");
  if (childScope === "az") return parentScope === "vpc";
  if (childScope === "subnet") return parentScope === "az";
  return false;
}

export function canDropNodeIntoContainer(draggedNode: Node, targetContainer: Node, isMultiRegion: boolean): boolean {
  const targetScope = getContainerScope(targetContainer);
  if (!targetScope) return false;

  if (draggedNode.type === "container") {
    const childScope = getContainerScope(draggedNode);
    return childScope ? isValidContainerParent(childScope, targetScope, isMultiRegion) : false;
  }

  return targetScope === "subnet";
}

export function findReparentTarget(draggedNode: Node, nodes: Node[], isMultiRegion = false): Node | null {
  const nodeMap = getNodeMap(nodes);
  const draggedRect = getNodeRect(draggedNode, nodeMap);
  const centerX = draggedRect.x + draggedRect.width / 2;
  const centerY = draggedRect.y + draggedRect.height / 2;

  const candidates = nodes
    .filter((node) => node.type === "container" && node.id !== draggedNode.id)
    .filter((node) => isPointInsideRect(centerX, centerY, getNodeRect(node, nodeMap)))
    .filter((node) => canDropNodeIntoContainer(draggedNode, node, isMultiRegion))
    .sort((left, right) => nodeDepth(right, nodeMap) - nodeDepth(left, nodeMap));

  return candidates[0] ?? null;
}

export function getReparentPosition(node: Node, targetContainer: Node, nodes: Node[]): { x: number; y: number } {
  const nodeMap = getNodeMap(nodes);
  const nodeRect = getNodeRect(node, nodeMap);
  const targetRect = getNodeRect(targetContainer, nodeMap);
  const nodeSize = getNodeSize(node);
  const targetSize = getNodeSize(targetContainer);

  const maxX = Math.max(0, targetSize.width - nodeSize.width);
  const maxY = Math.max(0, targetSize.height - nodeSize.height);

  return {
    x: clamp(nodeRect.x - targetRect.x, 0, maxX),
    y: clamp(nodeRect.y - targetRect.y, 0, maxY),
  };
}

export type ResizeBounds = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
};

export function getContainerResizeBounds(
  container: Node,
  nodes: Node[],
  nodeMapArg?: Map<string, Node>
): ResizeBounds {
  const minSize = getContainerMinSize(container, nodes);

  if (!container.parentId) {
    return {
      minWidth: minSize.width,
      minHeight: minSize.height,
      maxWidth: Infinity,
      maxHeight: Infinity,
    };
  }

  const nodeMap = nodeMapArg ?? getNodeMap(nodes);
  const parent = nodeMap.get(container.parentId);
  if (!parent) {
    return {
      minWidth: minSize.width,
      minHeight: minSize.height,
      maxWidth: Infinity,
      maxHeight: Infinity,
    };
  }

  const parentSize = getNodeSize(parent);
  const childX = Number.isFinite(container.position?.x) ? Number(container.position.x) : 0;
  const childY = Number.isFinite(container.position?.y) ? Number(container.position.y) : 0;

  const rawMaxWidth = parentSize.width - childX;
  const rawMaxHeight = parentSize.height - childY;

  return {
    minWidth: minSize.width,
    minHeight: minSize.height,
    maxWidth: Math.max(minSize.width, Math.max(0, rawMaxWidth)),
    maxHeight: Math.max(minSize.height, Math.max(0, rawMaxHeight)),
  };
}

export function getNodeMapForResize(nodes: Node[]): Map<string, Node> {
  return getNodeMap(nodes);
}
