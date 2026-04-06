type BudgetCapRecoveryDetails = {
  budgetCap: number;
  estimatedTotal: number;
  overage: number;
};

export type BudgetRecoveryMetadata = {
  status: string;
  budgetCap?: number;
  estimatedTotal?: number;
  overage?: number;
  traceId?: string;
};

type GenerationSnapshotHydration = {
  nodes: unknown[];
  edges: unknown[];
  costEstimatePayload: Record<string, unknown> | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseBudgetCapRecoveryDetails(message: Record<string, unknown>): BudgetCapRecoveryDetails | null {
  if (message.error !== "budget_cap_unmet") {
    return null;
  }

  const budgetCap = asFiniteNumber(message.budget_cap);
  const estimatedTotal = asFiniteNumber(message.estimated_total);
  if (budgetCap === null || estimatedTotal === null) {
    return null;
  }

  const overageRaw = asFiniteNumber(message.overage);
  const overage = overageRaw === null ? roundCurrency(Math.max(estimatedTotal - budgetCap, 0)) : roundCurrency(overageRaw);

  return {
    budgetCap: roundCurrency(budgetCap),
    estimatedTotal: roundCurrency(estimatedTotal),
    overage,
  };
}

export function buildBudgetCapRecoveryAssistantMessage(details: BudgetCapRecoveryDetails): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    `The generated architecture is estimated at ${formatter.format(details.estimatedTotal)}/mo, ` +
    `${formatter.format(details.overage)} over your ${formatter.format(details.budgetCap)} budget. ` +
    "Reply with \"retry\" to run another tighter pass, or \"accept\" to continue with this architecture."
  );
}

export function parseBudgetRecoveryMetadata(message: Record<string, unknown>): BudgetRecoveryMetadata | null {
  const source =
    typeof message.budget_recovery === "object" && message.budget_recovery !== null
      ? (message.budget_recovery as Record<string, unknown>)
      : null;
  if (!source) return null;

  const rawStatus = source.status;
  if (typeof rawStatus !== "string" || !rawStatus.trim()) return null;

  const budgetCap = asFiniteNumber(source.budget_cap);
  const estimatedTotal = asFiniteNumber(source.estimated_total);
  const overage = asFiniteNumber(source.overage);
  const traceId =
    typeof source.trace_id === "string" && source.trace_id.trim().length > 0
      ? source.trace_id.trim()
      : null;

  return {
    status: rawStatus.trim().toLowerCase(),
    ...(budgetCap !== null ? { budgetCap: roundCurrency(budgetCap) } : {}),
    ...(estimatedTotal !== null ? { estimatedTotal: roundCurrency(estimatedTotal) } : {}),
    ...(overage !== null ? { overage: roundCurrency(overage) } : {}),
    ...(traceId ? { traceId } : {}),
  };
}

export function parseGenerationSnapshotHydration(message: Record<string, unknown>): GenerationSnapshotHydration | null {
  if (message.type !== "generation_snapshot") return null;
  if (!Array.isArray(message.nodes) || !Array.isArray(message.edges)) return null;

  const costEstimatePayload =
    typeof message.cost_estimate === "object" && message.cost_estimate !== null
      ? (message.cost_estimate as Record<string, unknown>)
      : null;

  return {
    nodes: message.nodes,
    edges: message.edges,
    costEstimatePayload,
  };
}
