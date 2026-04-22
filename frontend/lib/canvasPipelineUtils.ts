import type { CanvasMessage, CanvasSession, PersistedProject, CostBreakdown } from "@/lib/projects";
import type { SetupPdfState } from "@/lib/setupPdf";
import type { TerraformFile } from "@/components/OutputPanel";
import { parseBudgetRecoveryMetadata } from "./budgetCapRecovery";

export function normalizeSetupPdfStatus(value: unknown): SetupPdfState["status"] {
  if (value === "none" || value === "generating" || value === "ready" || value === "failed" || value === "outdated") {
    return value;
  }
  return "none";
}

export function setupPdfStateFromProject(project: PersistedProject): SetupPdfState {
  return {
    status: normalizeSetupPdfStatus(project.setupPdfStatus),
    progress: Math.max(0, Math.min(100, Math.round(project.setupPdfProgress ?? 0))),
    error: project.setupPdfError,
    generatedAt: project.setupPdfGeneratedAt,
    sourceRevision: project.setupPdfSourceRevision,
  };
}

export function upsertTerraformFile(existing: TerraformFile[], incoming: TerraformFile): TerraformFile[] {
  const index = existing.findIndex((file) => file.filename === incoming.filename);
  if (index === -1) {
    return [...existing, incoming];
  }

  const next = [...existing];
  next[index] = incoming;
  return next;
}

export function inferPipelineErrorCode(
  payload: Record<string, unknown>,
  fallbackMessage?: string | null
): string | null {
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  const budgetRecovery = parseBudgetRecoveryMetadata(payload);
  if (budgetRecovery?.status === "pending") {
    return "budget_cap_unmet";
  }
  const normalizedMessage = typeof fallbackMessage === "string" ? fallbackMessage.trim().toLowerCase() : "";
  if (normalizedMessage.includes("budget hard cap unmet")) {
    return "budget_cap_unmet";
  }
  return null;
}

export function removeNodeFromCostEstimate(
  current: CostBreakdown | null,
  nodeId: string
): CostBreakdown | null {
  if (!current) return current;
  const trimmedNodeId = nodeId.trim();
  if (!trimmedNodeId) return current;

  const items = current.items.filter((item) => item.node_id !== trimmedNodeId);
  if (items.length === current.items.length) return current;

  const monthlyTotal = items.reduce((sum, item) => sum + item.cost, 0);
  return {
    ...current,
    items,
    monthly_total: Math.round(monthlyTotal * 100) / 100,
  };
}

export function hasInvalidNodePositions(nodes: { position?: { x?: unknown; y?: unknown } }[]): boolean {
  if (nodes.length === 0) return false;

  let allZero = true;
  for (const node of nodes) {
    const x = Number(node.position?.x);
    const y = Number(node.position?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x !== 0 || y !== 0) allZero = false;
  }

  return allZero;
}

export function getSessionKey(canvasSession: CanvasSession): string {
  if (canvasSession.mode === "existing") {
    return `existing:${canvasSession.project.id}`;
  }

  return `${canvasSession.mode}:${canvasSession.projectId ?? "none"}:${JSON.stringify(canvasSession.answers)}`;
}

export function latestPendingChatPlanId(messages: CanvasMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const planMeta = msg.planMeta;
    if (!planMeta || (planMeta.type !== "architecture_refactor" && planMeta.type !== "node_patch") || !planMeta.plan_id) continue;
    const status = planMeta.status ?? "";
    if (status === "pending") return planMeta.plan_id;
    if (status === "approved" || status === "executed" || status === "rejected" || status === "cancelled") {
      return null;
    }
  }
  return null;
}

export function requestedChangeForPlan(messages: CanvasMessage[], planId: string): string | null {
  const normalizedPlanId = planId.trim();
  if (!normalizedPlanId) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const planMeta = msg.planMeta;
    if (!planMeta || planMeta.type !== "architecture_refactor") continue;
    if (planMeta.plan_id !== normalizedPlanId) continue;
    const requestedChange = typeof planMeta.requested_change === "string" ? planMeta.requested_change.trim() : "";
    if (requestedChange) return requestedChange;
  }
  return null;
}

export function parseIncomingCostEstimate(message: Record<string, unknown>): CostBreakdown | null {
  if (typeof message.region !== "string" || !message.region.trim()) return null;
  if (typeof message.monthly_total !== "number" || !Number.isFinite(message.monthly_total)) return null;
  if (!Array.isArray(message.items)) return null;

  const items = message.items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .flatMap((item) => {
      const nodeId = typeof item.node_id === "string" ? item.node_id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const cost = typeof item.cost === "number" && Number.isFinite(item.cost) ? item.cost : null;
      if (!nodeId || !label || cost === null) return [];
      const expectedCost =
        typeof item.expected_cost === "number" && Number.isFinite(item.expected_cost) ? item.expected_cost : null;
      const estimated = item.estimated === true;
      const unpriced = item.unpriced === true;
      const instanceType = typeof item.instance_type === "string" && item.instance_type.trim() ? item.instance_type.trim() : undefined;
      return [
        {
          node_id: nodeId,
          label,
          cost,
          ...(expectedCost !== null ? { expected_cost: expectedCost } : {}),
          estimated,
          ...(unpriced ? { unpriced: true } : {}),
          ...(instanceType ? { instance_type: instanceType } : {}),
        },
      ];
    });

  const costEstimate: CostBreakdown = {
    region: message.region.trim(),
    monthly_total: message.monthly_total,
    items,
  };

  if (typeof message.budget_cap === "number" && Number.isFinite(message.budget_cap)) {
    costEstimate.budget_cap = message.budget_cap;
  }
  if (typeof message.monthly_budget === "number" && Number.isFinite(message.monthly_budget)) {
    costEstimate.monthly_budget = message.monthly_budget;
  }
  if (typeof message.over_budget === "boolean") {
    costEstimate.over_budget = message.over_budget;
  }
  if (
    typeof message.scenarios === "object" &&
    message.scenarios !== null &&
    typeof (message.scenarios as { baseline_total?: unknown }).baseline_total === "number" &&
    typeof (message.scenarios as { expected_total?: unknown }).expected_total === "number" &&
    typeof (message.scenarios as { peak_total?: unknown }).peak_total === "number"
  ) {
    costEstimate.scenarios = {
      baseline_total: (message.scenarios as { baseline_total: number }).baseline_total,
      expected_total: (message.scenarios as { expected_total: number }).expected_total,
      peak_total: (message.scenarios as { peak_total: number }).peak_total,
    };
  }

  return costEstimate;
}
