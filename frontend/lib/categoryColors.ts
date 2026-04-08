export const categoryColors: Record<string, string> = {
  network: "#3b82f6",   // blue
  compute: "#f97316",   // orange
  database: "#22c55e",  // green
  storage: "#eab308",   // yellow
  security: "#ef4444",  // red
  monitoring: "#a855f7", // purple
};

export const containerColors: Record<string, string> = {
  region: "#8b5cf6",
  vpc: "#3b82f6",
  az: "#6366f1",
  subnet: "#14b8a6",
};

export function colorForCategory(category: string): string {
  return categoryColors[category] ?? "#6b7280";
}

export function colorForContainerType(containerType: string): string {
  return containerColors[containerType] ?? containerColors.vpc;
}
