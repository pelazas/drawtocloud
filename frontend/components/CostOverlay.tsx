"use client";

import { useMemo, useState } from "react";
import type { CostBreakdown } from "@/lib/projects";

type CostOverlayProps = {
  costEstimate: CostBreakdown | null;
};

function formatMoney(value: number): string {
  return `$${value.toFixed(0)}`;
}

export default function CostOverlay({ costEstimate }: CostOverlayProps) {
  const [expanded, setExpanded] = useState(true);

  const sortedItems = useMemo(() => {
    if (!costEstimate) return [];
    return [...costEstimate.items].sort((a, b) => b.cost - a.cost);
  }, [costEstimate]);

  if (!costEstimate || costEstimate.monthly_total <= 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="absolute top-3 right-3 z-10 rounded-xl border border-white/10 bg-black/35 px-4 py-2 text-base font-semibold text-green-300 backdrop-blur-md"
      >
        {formatMoney(costEstimate.monthly_total)}/mo
      </button>
    );
  }

  return (
    <div className="absolute top-3 right-3 z-10 w-80 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-300">Prices ({costEstimate.region})</p>
          <p className="text-xs text-gray-400">Estimated monthly cost</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-gray-200 hover:bg-white/10"
        >
          Close
        </button>
      </div>

      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {sortedItems.map((item) => (
          <div key={item.node_id} className="rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-100">{item.label}</p>
                {item.instance_type && <p className="truncate text-[11px] text-gray-400">{item.instance_type}</p>}
              </div>
              <div className="shrink-0 text-right text-xs font-medium text-green-300">
                {item.estimated ? "~" : ""}
                {formatMoney(item.cost)}
                {item.estimated && <span className="ml-1 text-[10px] uppercase text-gray-400">est.</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between text-sm font-semibold">
          <span className="text-gray-200">Total</span>
          <span className="text-green-300">{formatMoney(costEstimate.monthly_total)}/mo</span>
        </div>
      </div>
    </div>
  );
}
