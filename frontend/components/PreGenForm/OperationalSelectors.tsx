"use client";

import { REGION_OPTIONS, EXPECTED_USERS_OPTIONS, UPTIME_OPTIONS } from "./usePreGenForm";

function ButtonGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              value === opt
                ? "bg-blue-600 text-white border-blue-500"
                : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

interface OperationalSelectorsProps {
  region: string;
  onRegionChange: (v: string) => void;
  expectedUsers: string;
  onExpectedUsersChange: (v: string) => void;
  uptime: string;
  onUptimeChange: (v: string) => void;
}

export default function OperationalSelectors({
  region,
  onRegionChange,
  expectedUsers,
  onExpectedUsersChange,
  uptime,
  onUptimeChange,
}: OperationalSelectorsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <ButtonGroup
        label="Region"
        options={REGION_OPTIONS}
        value={region}
        onChange={onRegionChange}
      />
      <ButtonGroup
        label="Expected users"
        options={EXPECTED_USERS_OPTIONS}
        value={expectedUsers}
        onChange={onExpectedUsersChange}
      />
      <ButtonGroup
        label="Uptime"
        options={UPTIME_OPTIONS}
        value={uptime}
        onChange={onUptimeChange}
      />
    </div>
  );
}
