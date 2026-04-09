export function getCanvasInteractionPolicy(canDragNodes: boolean, readOnly: boolean) {
  return {
    nodesDraggable: canDragNodes,
    nodesConnectable: false,
    elementsSelectable: !readOnly,
    deleteKeyCode: null,
    selectionOnDrag: !readOnly,
  };
}

export function shouldShowContainerResizeHandle(selected: boolean, isEditable: boolean) {
  return selected && isEditable;
}
