"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { COMPLIANCE_OPTIONS, ENVIRONMENT_OPTIONS, COMPUTE_OPTIONS } from "./usePreGenForm";

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

interface AdvancedOptionsProps {
  open: boolean;
  onToggle: () => void;
  compliance: string;
  onComplianceChange: (v: string) => void;
  environment: string;
  onEnvironmentChange: (v: string) => void;
  computePreference: string;
  onComputePreferenceChange: (v: string) => void;
}

export default function AdvancedOptions({
  open,
  onToggle,
  compliance,
  onComplianceChange,
  environment,
  onEnvironmentChange,
  computePreference,
  onComputePreferenceChange,
}: AdvancedOptionsProps) {
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
      >
        <span>Advanced options</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="px-4 py-4 bg-gray-900/50 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ButtonGroup
            label="Compliance"
            options={COMPLIANCE_OPTIONS}
            value={compliance}
            onChange={onComplianceChange}
          />
          <ButtonGroup
            label="Environment"
            options={ENVIRONMENT_OPTIONS}
            value={environment}
            onChange={onEnvironmentChange}
          />
          <ButtonGroup
            label="Compute preference"
            options={COMPUTE_OPTIONS}
            value={computePreference}
            onChange={onComputePreferenceChange}
          />
        </div>
      )}
    </div>
  );
}
