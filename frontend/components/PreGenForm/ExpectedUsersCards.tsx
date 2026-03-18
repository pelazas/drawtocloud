"use client";

import { EXPECTED_USERS_CARDS } from "./usePreGenForm";

interface ExpectedUsersCardsProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ExpectedUsersCards({ value, onChange }: ExpectedUsersCardsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">Expected Users</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {EXPECTED_USERS_CARDS.map((card) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onChange(card.value)}
            className={`flex flex-col gap-1 w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 ${
              value === card.value
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
            }`}
          >
            <span className="text-[15px] font-medium text-white">{card.label}</span>
            <span className="text-xs text-gray-500">{card.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
