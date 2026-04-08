import { normalizeContainerType, normalizeSubnetKind } from "../components/Canvas/containerNodeStyles";

export function buildContainerNodeData(
  containerTypeValue: unknown,
  label: string,
  category: string,
  subnetKindValue?: unknown
): {
  label: string;
  category: string;
  containerType: ReturnType<typeof normalizeContainerType>;
  subnetKind?: ReturnType<typeof normalizeSubnetKind>;
} {
  const containerType = normalizeContainerType(containerTypeValue);
  const subnetKind = normalizeSubnetKind(subnetKindValue);

  return {
    label,
    category,
    containerType,
    ...(containerType === "subnet" ? { subnetKind } : {}),
  };
}
