export function getCanvasInteractionPolicy(readOnly: boolean) {
  return {
    nodesDraggable: false,
    nodesConnectable: false,
    elementsSelectable: !readOnly,
    deleteKeyCode: null,
    selectionOnDrag: !readOnly,
    shouldPersistResize: false,
  };
}

export function shouldShowContainerResizeHandle(selected: boolean, isEditable: boolean) {
  return selected && isEditable;
}
