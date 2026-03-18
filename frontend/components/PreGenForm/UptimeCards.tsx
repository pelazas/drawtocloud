"use client";

import { UPTIME_CARDS } from "./usePreGenForm";

interface UptimeCardsProps {
  value: string;
  onChange: (value: string) => void;
}

export default function UptimeCards({ value, onChange }: UptimeCardsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">Uptime</span>
        <span
          className="text-gray-600 cursor-help"
          title="Higher availability requires redundant infrastructure, increasing costs."
        >
          (?)
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {UPTIME_CARDS.map((card) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onChange(card.value)}
            className={`flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 ${
              value === card.value
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium text-white">{card.label}</span>
                {"recommended" in card && card.recommended ? (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    Recommended
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-gray-500">{card.subtitle}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
