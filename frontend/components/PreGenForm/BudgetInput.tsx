"use client";

interface BudgetInputProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}

export default function BudgetInput({ value, onChange, error }: BudgetInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-gray-400">Monthly Budget (optional)</label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">$</span>
        <input
          type="number"
          min={5}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. 150"
          className="flex-1 px-[18px] py-[14px] rounded-[10px] bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-[15px] transition-colors"
        />
        <span className="text-sm text-gray-500">/ month</span>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {!error ? <p className="text-xs text-gray-600">Set a target to help the AI optimize for cost.</p> : null}
    </div>
  );
}
