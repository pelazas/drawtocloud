import type { CostBreakdown } from "@/lib/projects";

export type CostOverlayPresentation = {
  hidden: boolean;
  totalLabel: string;
  note: string | null;
};

function formatMoney(value: number): string {
  return `$${value.toFixed(0)}`;
}

export function buildCostOverlayPresentation(costEstimate: CostBreakdown | null): CostOverlayPresentation {
  if (!costEstimate) {
    return {
      hidden: true,
      totalLabel: "$0/mo",
      note: null,
    };
  }

  const items = costEstimate.items ?? [];
  const hasItems = items.length > 0;
  const hasUnpricedItems = items.some((item) => item.unpriced === true);

  if (costEstimate.monthly_total <= 0 && !hasItems) {
    return {
      hidden: true,
      totalLabel: "$0/mo",
      note: null,
    };
  }

  if (costEstimate.monthly_total <= 0 && hasItems) {
    return {
      hidden: false,
      totalLabel: "~$0/mo",
      note: hasUnpricedItems ? "Some items are internal components (e.g. controllers, pods) and don't have direct AWS costs." : null,
    };
  }

  return {
    hidden: false,
    totalLabel: `${formatMoney(costEstimate.monthly_total)}/mo`,
    note: hasUnpricedItems ? "Some items are internal components (e.g. controllers, pods) and don't have direct AWS costs." : null,
  };
}
