"use client";

import { useState } from "react";

interface Props {
  label: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}

export default function OptionButton({ label, index, selected, onClick }: Props) {
  const [pressing, setPressing] = useState(false);

  function handleClick() {
    setPressing(true);
    setTimeout(() => {
      setPressing(false);
      onClick();
    }, 100);
  }

  return (
    <button
      onClick={handleClick}
      style={
        selected
          ? {
              background: "rgb(14 24 45)",
              borderColor: "rgb(59 130 246)",
              boxShadow:
                "0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)",
            }
          : undefined
      }
      className={[
        "flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] text-left transition-all duration-150",
        pressing ? "scale-[0.98]" : "",
        selected
          ? "border border-blue-500"
          : "border border-[rgb(40_40_50)] bg-[rgb(15_15_20)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)] hover:translate-x-[3px]",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="text-[15px] text-gray-200 font-normal">{label}</span>
      <span className="text-xs text-gray-600 font-mono ml-4 shrink-0 hidden sm:block">
        {index + 1}
      </span>
    </button>
  );
}
