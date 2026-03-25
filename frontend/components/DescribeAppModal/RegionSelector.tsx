"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_AWS_REGIONS,
  REGION_LABELS,
  detectRecommendedRegions,
  detectRecommendedRegionsByIp,
  detectTimezone,
  type AWSRegion,
} from "@/lib/regionDetect";
import { MAX_SELECTED_REGIONS, toggleRegionSelection } from "./form";

type Props = {
  regions: string[];
  onChange: (regions: string[]) => void;
};

type RegionOptionProps = {
  region: AWSRegion;
  selected: boolean;
  disabled: boolean;
  onToggle: (region: AWSRegion) => void;
};

function RegionOption({ region, selected, disabled, onToggle }: RegionOptionProps) {
  return (
    <label
      className={`flex w-full cursor-pointer items-center gap-3 rounded-[10px] border px-[18px] py-[14px] text-left transition-all duration-150 ${
        selected
          ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
          : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
      } ${!selected && disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(region)}
        disabled={!selected && disabled}
        className="sr-only"
      />
      <div
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
          selected ? "border-blue-500 bg-blue-500" : "border-gray-600 bg-transparent"
        }`}
      >
        {selected ? (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
      </div>
      <span className="text-[15px] text-white">{region}</span>
      <span className="ml-1 text-sm text-gray-500">{REGION_LABELS[region]}</span>
    </label>
  );
}

export default function RegionSelector({ regions, onChange }: Props) {
  const timezone = detectTimezone();
  const fallbackRecommended = useMemo(() => detectRecommendedRegions(timezone), [timezone]);
  const [recommended, setRecommended] = useState<AWSRegion[]>(fallbackRecommended);
  const [showOther, setShowOther] = useState(false);
  const [filter, setFilter] = useState("");
  const initializedRef = useRef(false);
  const regionsRef = useRef(regions);
  const atLimit = regions.length >= MAX_SELECTED_REGIONS;

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (regions.length === 0 && fallbackRecommended[0]) {
      onChange([fallbackRecommended[0]]);
    }

    let cancelled = false;
    void detectRecommendedRegionsByIp({ fallbackTimezone: timezone }).then((next) => {
      if (cancelled) return;
      setRecommended(next);
      const currentSelection = regionsRef.current;
      if (currentSelection.length === 1 && currentSelection[0] === fallbackRecommended[0] && next[0]) {
        onChange([next[0]]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fallbackRecommended, onChange, regions.length, timezone]);

  const filteredOther = useMemo(() => {
    const otherRegions = ALL_AWS_REGIONS.filter((region) => !recommended.includes(region));
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return otherRegions;
    return otherRegions.filter((region) => {
      const label = REGION_LABELS[region] ?? "";
      return region.includes(normalizedFilter) || label.toLowerCase().includes(normalizedFilter);
    });
  }, [filter, recommended]);

  function handleToggle(region: AWSRegion) {
    onChange(toggleRegionSelection(regions, region));
  }

  const recommendedText = recommended.map((region) => `${region} (${REGION_LABELS[region]})`).join(", ");

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-gray-400">AWS Regions</span>
      <p className="text-xs text-gray-500">
        Recommended from your IP location: <span className="text-gray-300">{recommendedText}</span>
      </p>

      <div className="flex flex-col gap-2">
        {recommended.map((region) => (
          <RegionOption
            key={region}
            region={region}
            selected={regions.includes(region)}
            disabled={atLimit}
            onToggle={handleToggle}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowOther((prev) => !prev)}
        className="mt-1 text-left text-xs text-gray-500 transition-colors hover:text-gray-300"
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
            className="rounded-lg border border-[rgb(40_40_50)] bg-[rgb(15_15_20)] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {filteredOther.map((region) => (
              <RegionOption
                key={region}
                region={region}
                selected={regions.includes(region)}
                disabled={atLimit}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-gray-500">
        {regions.length} region{regions.length === 1 ? "" : "s"} selected
        {atLimit ? <span className="ml-2 text-yellow-500">Maximum {MAX_SELECTED_REGIONS} regions</span> : null}
      </p>
    </div>
  );
}
