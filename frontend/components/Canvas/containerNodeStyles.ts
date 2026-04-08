import { colorForContainerType as colorForContainerTypeFromLib } from "../../lib/categoryColors";

export type ContainerType = "region" | "vpc" | "az" | "subnet";
export type SubnetKind = "public" | "private";

const DEFAULT_CONTAINER_TYPE: ContainerType = "vpc";
const DEFAULT_SUBNET_KIND: SubnetKind = "private";

const defaultContainerSizes: Record<ContainerType, { width: number; height: number }> = {
  region: { width: 860, height: 640 },
  vpc: { width: 700, height: 500 },
  az: { width: 500, height: 400 },
  subnet: { width: 400, height: 300 },
};

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha));
}

export function normalizeContainerType(value: unknown): ContainerType {
  return value === "region" || value === "az" || value === "subnet" || value === "vpc"
    ? value
    : DEFAULT_CONTAINER_TYPE;
}

export function normalizeSubnetKind(value: unknown): SubnetKind {
  return value === "public" || value === "private" ? value : DEFAULT_SUBNET_KIND;
}

export function colorForContainerType(value: unknown): string {
  return colorForContainerTypeFromLib(normalizeContainerType(value));
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

export function getContainerNodeStyles(
  value: unknown,
  selected: boolean,
  dragOver = false,
  subnetKind: unknown = DEFAULT_SUBNET_KIND
): {
  borderColor: string;
  background: string;
  labelColor: string;
  badgeLabel?: string;
  badgeColor?: string;
  boxShadow?: string;
} {
  const containerType = normalizeContainerType(value);
  const color = colorForContainerType(containerType);
  const normalizedSubnetKind = normalizeSubnetKind(subnetKind);
  const baseBackgroundAlpha = dragOver ? 0.1 : containerType === "subnet" && normalizedSubnetKind === "public" ? 0.08 : 0.04;

  return {
    borderColor: `${color}${dragOver ? "cc" : "99"}`,
    background: hexToRgba(color, baseBackgroundAlpha),
    labelColor: color,
    ...(containerType === "subnet"
      ? {
          badgeLabel: normalizedSubnetKind.toUpperCase(),
          badgeColor: normalizedSubnetKind === "public" ? "#99f6e4" : "#bfdbfe",
        }
      : {}),
    ...(selected
      ? { boxShadow: `0 0 0 1px ${hexToRgba(color, 0.3)}, inset 0 0 20px ${hexToRgba(color, 0.05)}` }
      : dragOver
      ? { boxShadow: `0 0 0 1px ${hexToRgba(color, 0.35)}, inset 0 0 24px ${hexToRgba(color, 0.08)}` }
      : {}),
  };
}
