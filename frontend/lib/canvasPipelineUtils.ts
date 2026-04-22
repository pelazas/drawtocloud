import type { CanvasMessage, PersistedProject } from "@/lib/projects";
import type { SetupPdfState } from "@/lib/setupPdf";
import type { TerraformFile } from "@/components/OutputPanel";
import type { CostBreakdown } from "@/lib/projects";
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
