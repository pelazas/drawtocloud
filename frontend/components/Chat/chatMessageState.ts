import type { CanvasMessage } from "@/lib/projects";

export function latestPlanMessageIndex(messages: CanvasMessage[]): number {
  return messages.reduce<number>(
    (latest, msg, index) => (msg.role === "assistant" && msg.planReady ? index : latest),
    -1
  );
}

export function latestPendingBudgetRecoveryMessageIndex(messages: CanvasMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.budgetRecovery) continue;
    const status = msg.budgetRecovery.status.trim().toLowerCase();
    if (status === "pending") return i;
    if (status === "accepted" || status === "retry_started" || status === "resolved" || status === "cancelled") {
      return -1;
    }
  }
  return -1;
}
