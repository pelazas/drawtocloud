export type BudgetRetryStatus = "idle" | "in_progress" | "succeeded" | "failed";

export type BudgetRetryState = {
  status: BudgetRetryStatus;
  message: string | null;
  budgetCap: number | null;
  estimatedTotal: number | null;
  overage: number | null;
  stage: string | null;
  event: string | null;
  traceId: string | null;
  updatedAt: number | null;
};

export type BudgetRetryEventPayload = {
  stage: string | null;
  event: string | null;
  message?: string | null;
  details?: Record<string, unknown>;
  traceId?: string | null;
  timestamp?: number;
};

export const INITIAL_BUDGET_RETRY_STATE: BudgetRetryState = {
  status: "idle",
  message: null,
  budgetCap: null,
  estimatedTotal: null,
  overage: null,
  stage: null,
  event: null,
  traceId: null,
  updatedAt: null,
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function deriveStatus(current: BudgetRetryStatus, stage: string | null, event: string | null): BudgetRetryStatus {
  if (stage === "budget_retry") {
    return current === "idle" ? "in_progress" : current;
  }

  if (stage !== "budget_cap") return current;
  if (event === "retry_started") return "in_progress";
  if (event === "retry_succeeded") return "succeeded";
  if (event === "retry_failed") return "failed";
  return current;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function reduceBudgetRetryState(
  current: BudgetRetryState,
  payload: BudgetRetryEventPayload
): BudgetRetryState {
  const { stage, event, message, details, traceId, timestamp } = payload;
  if (stage !== "budget_cap" && stage !== "budget_retry") {
    return current;
  }

  const status = deriveStatus(current.status, stage, event);
  const budgetCap = asFiniteNumber(details?.budget_cap) ?? current.budgetCap;
  const estimatedTotal = asFiniteNumber(details?.estimated_total) ?? current.estimatedTotal;
  const overage = asFiniteNumber(details?.overage) ?? current.overage;

  return {
    status,
    message: typeof message === "string" && message.trim().length > 0 ? message : current.message,
    budgetCap,
    estimatedTotal,
    overage,
    stage,
    event: event ?? current.event,
    traceId: traceId ?? current.traceId,
    updatedAt: typeof timestamp === "number" ? timestamp : Date.now(),
  };
}

export function formatBudgetRetryStatus(state: BudgetRetryState): string | null {
  if (state.status === "idle") return null;
  if (state.status === "succeeded") return null;

  const headline =
    state.status === "in_progress"
      ? "Budget retry in progress"
      : "Budget retry failed";

  const details: string[] = [];
  if (state.budgetCap !== null) details.push(`cap ${formatCurrency(state.budgetCap)}`);
  if (state.estimatedTotal !== null) details.push(`estimated ${formatCurrency(state.estimatedTotal)}`);
  if (state.overage !== null && state.overage > 0) details.push(`overage ${formatCurrency(state.overage)}`);

  const context: string[] = [];
  if (state.stage && state.event) context.push(`${state.stage}.${state.event}`);
  else if (state.stage) context.push(state.stage);
  if (state.traceId) context.push(`trace ${state.traceId}`);

  const parts = [headline];
  if (details.length > 0) parts.push(details.join(" | "));
  if (context.length > 0) parts.push(context.join(" | "));
  if (state.message) parts.push(state.message);
  return parts.join(" - ");
}
