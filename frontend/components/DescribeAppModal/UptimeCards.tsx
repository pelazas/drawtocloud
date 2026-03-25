"use client";

import { UPTIME_CARDS } from "./form";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export default function UptimeCards({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-gray-400">Uptime</span>
      <div className="flex flex-col gap-2">
        {UPTIME_CARDS.map((card) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onChange(card.value)}
            className={`flex w-full items-center justify-between rounded-[10px] border px-[18px] py-[14px] text-left transition-all duration-150 ${
              value === card.value
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium text-white">{card.title}</span>
              <span className="text-xs text-gray-400">{card.downtime}</span>
            </div>
            <span className="text-xs font-mono uppercase tracking-wide text-blue-300">{card.sla}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
