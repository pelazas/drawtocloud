"use client";

import { useMemo, useState } from "react";
import {
  ALL_AWS_REGIONS,
  REGION_LABELS,
  detectRecommendedRegions,
  detectTimezone,
  type AWSRegion,
} from "@/lib/regionDetect";

interface RegionSelectorProps {
  regions: string[];
  onToggle: (region: string) => void;
  maxRegions?: number;
}

interface RegionOptionProps {
  region: AWSRegion;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: (region: AWSRegion) => void;
}

function RegionOption({ region, isSelected, isDisabled, onToggle }: RegionOptionProps) {
  return (
    <label
      className={`flex items-center gap-3 w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 ${
        isSelected
          ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
          : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
      } ${!isSelected && isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(region)}
        disabled={!isSelected && isDisabled}
        className="sr-only"
      />
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          isSelected ? "bg-blue-500 border-blue-500" : "border-gray-600 bg-transparent"
        }`}
      >
        {isSelected ? (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
      </div>
      <span className="text-[15px] text-white">{region}</span>
      <span className="text-sm text-gray-500 ml-1">{REGION_LABELS[region]}</span>
    </label>
  );
}

const MAX_REGIONS_DEFAULT = 5;

export default function RegionSelector({ regions, onToggle, maxRegions = MAX_REGIONS_DEFAULT }: RegionSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  const [filter, setFilter] = useState("");
  const timezone = detectTimezone();
  const recommended = detectRecommendedRegions(timezone);
  const atLimit = regions.length >= maxRegions;

  const filteredOther = useMemo(() => {
    const otherRegions = ALL_AWS_REGIONS.filter((region) => !recommended.includes(region));
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return otherRegions;
    return otherRegions.filter((region) => {
      const label = REGION_LABELS[region] ?? "";
      return region.includes(normalizedFilter) || label.toLowerCase().includes(normalizedFilter);
    });
  }, [filter, recommended]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">Region</span>
        <span className="text-gray-600 cursor-help" title="The more regions you select, the higher your infrastructure costs.">
          (?)
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {recommended.map((region) => (
          <RegionOption
            key={region}
            region={region}
            isSelected={regions.includes(region)}
            isDisabled={atLimit}
            onToggle={onToggle}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowOther((prev) => !prev)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-left mt-1"
      >
        {showOther ? "Hide other regions" : "Other regions..."}
      </button>

      {showOther ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search regions..."
            className="px-3 py-2 rounded-lg bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          {filteredOther.map((region) => (
            <RegionOption
              key={region}
              region={region}
              isSelected={regions.includes(region)}
              isDisabled={atLimit}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}

      <p className="text-xs text-gray-500">
        {regions.length} region{regions.length === 1 ? "" : "s"} selected
        {atLimit ? <span className="text-yellow-500 ml-2">Maximum {maxRegions} regions</span> : null}
      </p>
    </div>
  );
}
