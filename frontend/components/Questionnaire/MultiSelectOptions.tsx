"use client";

interface Props {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  onConfirm: () => void;
}

export default function MultiSelectOptions({ options, selected, onToggle, onConfirm }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option, i) => {
        const sel = selected.includes(option);
        return (
          <label
            key={option}
            style={
              sel
                ? {
                    background: "rgb(14 24 45)",
                    borderColor: "rgb(59 130 246)",
                    boxShadow:
                      "0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)",
                  }
                : undefined
            }
            className={[
              "flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] cursor-pointer transition-all duration-150",
              sel
                ? "border border-blue-500"
                : "border border-[rgb(40_40_50)] bg-[rgb(15_15_20)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)] hover:translate-x-[3px]",
            ].join(" ")}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={sel}
                onChange={() => onToggle(option)}
                className="accent-blue-500 w-4 h-4"
              />
              <span className="text-[15px] text-gray-200 font-normal">{option}</span>
            </div>
            <span className="text-xs text-gray-600 font-mono hidden sm:block">{i + 1}</span>
          </label>
        );
      })}
      <div className="flex justify-end mt-2">
        <button
          onClick={onConfirm}
          disabled={selected.length === 0}
          className="px-6 py-[11px] rounded-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors text-sm"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
