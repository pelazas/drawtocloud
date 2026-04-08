export function shouldRestoreDragOrigin<T extends { parentId: string | null }>(
  dragOrigin?: T
): dragOrigin is T & { parentId: string } {
  return typeof dragOrigin?.parentId === "string" && dragOrigin.parentId.length > 0;
}
