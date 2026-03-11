export const categoryColors: Record<string, string> = {
  network: "#3b82f6",   // blue
  compute: "#f97316",   // orange
  database: "#22c55e",  // green
  storage: "#eab308",   // yellow
  security: "#ef4444",  // red
  monitoring: "#a855f7", // purple
};

export function colorForCategory(category: string): string {
  return categoryColors[category] ?? "#6b7280";
}
