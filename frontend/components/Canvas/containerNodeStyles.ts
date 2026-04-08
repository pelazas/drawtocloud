export type ContainerType = "vpc" | "az" | "subnet";

const DEFAULT_CONTAINER_TYPE: ContainerType = "vpc";

const containerColors: Record<ContainerType, string> = {
  vpc: "#3b82f6",
  az: "#6366f1",
  subnet: "#14b8a6",
};

const defaultContainerSizes: Record<ContainerType, { width: number; height: number }> = {
  vpc: { width: 700, height: 500 },
  az: { width: 500, height: 400 },
  subnet: { width: 400, height: 300 },
};

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha));
}

export function normalizeContainerType(value: unknown): ContainerType {
  return value === "az" || value === "subnet" || value === "vpc" ? value : DEFAULT_CONTAINER_TYPE;
}

export function colorForContainerType(value: unknown): string {
  return containerColors[normalizeContainerType(value)];
}

export function defaultContainerSize(value: unknown): { width: number; height: number } {
  return defaultContainerSizes[normalizeContainerType(value)];
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const safeAlpha = clampAlpha(alpha);
  const channels = normalized.length === 3
    ? normalized.split("").map((char) => Number.parseInt(`${char}${char}`, 16))
    : [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16),
      ];

  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${safeAlpha})`;
}

export function getContainerNodeStyles(value: unknown, selected: boolean): {
  borderColor: string;
  background: string;
  labelColor: string;
  boxShadow?: string;
} {
  const color = colorForContainerType(value);
  return {
    borderColor: `${color}99`,
    background: hexToRgba(color, 0.04),
    labelColor: color,
    ...(selected
      ? { boxShadow: `0 0 0 1px ${hexToRgba(color, 0.3)}, inset 0 0 20px ${hexToRgba(color, 0.05)}` }
      : {}),
  };
}
