# /new Page Form Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/new` page pre-generation form with timezone-based multi-region selection, t-shirt sizing cards, SLA uptime cards with real-world translations, and an optional monthly budget field.

**Architecture:** Refactor in-place. Replace `OperationalSelectors.tsx` with three new components (`RegionSelector`, `ExpectedUsersCards`, `UptimeCards`) grouped under a `ScaleResilience` wrapper. Add `BudgetInput` component. Update `usePreGenForm` hook for new types (`regions: string[]`, `monthly_budget?: number`). Minimal backend changes to accept the new field shapes.

**Tech Stack:** Next.js 14, Tailwind CSS, FastAPI, Python 3.12

**Spec:** `docs/superpowers/specs/2026-03-18-new-page-form-redesign.md`

---

## Task 1: Timezone-to-region detection utility

**Files:**
- Create: `frontend/lib/regionDetect.ts`
- Test: `frontend/lib/__tests__/regionDetect.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/lib/__tests__/regionDetect.test.ts
import { detectRecommendedRegions, ALL_AWS_REGIONS, REGION_LABELS } from "../regionDetect";

describe("detectRecommendedRegions", () => {
  it("returns 3 regions for America/New_York", () => {
    const result = detectRecommendedRegions("America/New_York");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("us-east-1");
  });

  it("returns 3 regions for Europe/Berlin", () => {
    const result = detectRecommendedRegions("Europe/Berlin");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("eu-central-1");
  });

  it("returns 3 regions for Asia/Tokyo", () => {
    const result = detectRecommendedRegions("Asia/Tokyo");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("ap-northeast-1");
  });

  it("returns 3 regions for Australia/Sydney", () => {
    const result = detectRecommendedRegions("Australia/Sydney");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("ap-southeast-2");
  });

  it("falls back to us-east-1 for unknown timezone", () => {
    const result = detectRecommendedRegions("Unknown/Zone");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("us-east-1");
  });

  it("falls back to us-east-1 for undefined", () => {
    const result = detectRecommendedRegions(undefined as unknown as string);
    expect(result[0]).toBe("us-east-1");
  });

  it("ALL_AWS_REGIONS has at least 15 regions", () => {
    expect(ALL_AWS_REGIONS.length).toBeGreaterThanOrEqual(15);
  });

  it("REGION_LABELS maps every region to a friendly name", () => {
    for (const region of ALL_AWS_REGIONS) {
      expect(REGION_LABELS[region]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run lib/__tests__/regionDetect.test.ts 2>&1 || true`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/lib/regionDetect.ts

export const ALL_AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ap-south-1",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
] as const;

export type AWSRegion = typeof ALL_AWS_REGIONS[number];

export const REGION_LABELS: Record<string, string> = {
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-1": "N. California",
  "us-west-2": "Oregon",
  "ca-central-1": "Canada",
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-north-1": "Stockholm",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka",
  "ap-south-1": "Mumbai",
  "sa-east-1": "São Paulo",
  "me-south-1": "Bahrain",
  "af-south-1": "Cape Town",
};

const TIMEZONE_TO_REGIONS: Record<string, string[]> = {
  "America": ["us-east-1", "us-west-2", "ca-central-1"],
  "US": ["us-east-1", "us-west-2", "us-east-2"],
  "Canada": ["ca-central-1", "us-east-1", "us-west-2"],
  "Europe": ["eu-central-1", "eu-west-1", "eu-north-1"],
  "Africa": ["af-south-1", "eu-west-1", "me-south-1"],
  "Asia": ["ap-southeast-1", "ap-northeast-1", "ap-south-1"],
  "Australia": ["ap-southeast-2", "ap-southeast-1", "ap-northeast-1"],
  "Pacific": ["ap-southeast-2", "ap-northeast-1", "us-west-2"],
  "Atlantic": ["eu-west-1", "us-east-1", "sa-east-1"],
  "Indian": ["ap-south-1", "ap-southeast-1", "me-south-1"],
};

// More specific timezone city overrides
const CITY_OVERRIDES: Record<string, string[]> = {
  "America/New_York": ["us-east-1", "us-east-2", "ca-central-1"],
  "America/Chicago": ["us-east-1", "us-west-2", "us-east-2"],
  "America/Denver": ["us-west-2", "us-east-1", "us-west-1"],
  "America/Los_Angeles": ["us-west-2", "us-west-1", "us-east-1"],
  "America/Sao_Paulo": ["sa-east-1", "us-east-1", "eu-west-1"],
  "Europe/London": ["eu-west-2", "eu-west-1", "eu-central-1"],
  "Europe/Berlin": ["eu-central-1", "eu-west-1", "eu-north-1"],
  "Europe/Paris": ["eu-west-3", "eu-central-1", "eu-west-1"],
  "Europe/Stockholm": ["eu-north-1", "eu-central-1", "eu-west-1"],
  "Asia/Tokyo": ["ap-northeast-1", "ap-northeast-3", "ap-northeast-2"],
  "Asia/Seoul": ["ap-northeast-2", "ap-northeast-1", "ap-northeast-3"],
  "Asia/Singapore": ["ap-southeast-1", "ap-northeast-1", "ap-south-1"],
  "Asia/Kolkata": ["ap-south-1", "ap-southeast-1", "me-south-1"],
  "Asia/Dubai": ["me-south-1", "ap-south-1", "eu-central-1"],
  "Australia/Sydney": ["ap-southeast-2", "ap-southeast-1", "ap-northeast-1"],
};

const DEFAULT_REGIONS = ["us-east-1", "us-west-2", "eu-west-1"];

export function detectRecommendedRegions(timezone?: string): string[] {
  if (!timezone) return DEFAULT_REGIONS;

  // Try exact city match first
  if (CITY_OVERRIDES[timezone]) return CITY_OVERRIDES[timezone];

  // Try continent prefix
  const continent = timezone.split("/")[0];
  if (TIMEZONE_TO_REGIONS[continent]) return TIMEZONE_TO_REGIONS[continent];

  return DEFAULT_REGIONS;
}

export function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run lib/__tests__/regionDetect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/regionDetect.ts frontend/lib/__tests__/regionDetect.test.ts
git commit -m "feat: add timezone-to-region detection utility (#51)"
```

---

## Task 2: Update usePreGenForm hook types and state

**Files:**
- Modify: `frontend/components/PreGenForm/usePreGenForm.ts`

- [ ] **Step 1: Update types and options**

Replace `REGION_OPTIONS` and `UPTIME_OPTIONS`:

```typescript
// Remove: export const REGION_OPTIONS = [...]
// Remove: export const UPTIME_OPTIONS = ["Best effort", "99.9% SLA", "99.99% SLA"];

// Add:
export const UPTIME_OPTIONS = ["99.0% SLA", "99.9% SLA", "99.99% SLA"];

export const EXPECTED_USERS_CARDS = [
  { label: "MVP / Just exploring", description: "Perfect for testing an idea, internal tools, or side projects with a minimal footprint.", value: "<1K/mo" },
  { label: "Early Traction", description: "For growing apps with consistent early users needing reliable performance.", value: "1K\u2013100K/mo" },
  { label: "Growing Business", description: "For scaling platforms expecting steady daily traffic and needing higher capacity.", value: "100K\u20131M/mo" },
  { label: "Enterprise Scale", description: "For high-volume, mission-critical applications requiring maximum concurrent load.", value: "1M+/mo" },
] as const;

export const UPTIME_CARDS = [
  { label: "Standard", value: "99.0% SLA", subtitle: "Up to ~7h downtime/month" },
  { label: "High Availability", value: "99.9% SLA", subtitle: "Up to ~43min downtime/month", recommended: true },
  { label: "Mission Critical", value: "99.99% SLA", subtitle: "Up to ~4min downtime/month" },
] as const;
```

Update `PreGenAnswers` type:

```typescript
export type PreGenAnswers = {
  app_name: string;
  description?: string;
  regions: string[];        // was: region: string
  expected_users: string;
  uptime: string;
  compliance?: string;
  environment?: string;
  compute_preference?: string;
  monthly_budget?: number;  // new
};
```

Update `UsePreGenFormResult` type:

```typescript
// Replace:
//   region: string;
//   setRegion: (v: string) => void;
// With:
  regions: string[];
  setRegions: (v: string[]) => void;
  toggleRegion: (region: string) => void;
  monthlyBudget: string;
  setMonthlyBudget: (v: string) => void;
  budgetError: string | null;
```

Update `usePreGenForm` function body:

```typescript
// Replace: const [region, setRegion] = useState("us-east-1");
// With:
import { detectRecommendedRegions, detectTimezone } from "@/lib/regionDetect";

const [regions, setRegions] = useState<string[]>(() => {
  const tz = detectTimezone();
  const recommended = detectRecommendedRegions(tz);
  return [recommended[0]];
});
const [monthlyBudget, setMonthlyBudget] = useState("");

// Replace: const [uptime, setUptime] = useState("99.9% SLA");
// Keep this default — it matches "High Availability" (recommended)

const MAX_REGIONS = 5;

function toggleRegion(region: string) {
  setRegions((prev) => {
    if (prev.includes(region)) {
      return prev.length > 1 ? prev.filter((r) => r !== region) : prev;
    }
    if (prev.length >= MAX_REGIONS) return prev;
    return [...prev, region];
  });
}

const budgetError = monthlyBudget !== "" && (isNaN(Number(monthlyBudget)) || Number(monthlyBudget) < 5)
  ? "Minimum budget is $5/month"
  : null;

// Update buildAnswers:
function buildAnswers(): PreGenAnswers {
  const answers: PreGenAnswers = {
    app_name: appName.trim(),
    regions,
    expected_users: expectedUsers,
    uptime,
  };
  if (isFastPath) answers.description = description.trim();
  if (compliance !== "None") answers.compliance = compliance;
  if (environment !== "Production") answers.environment = environment;
  if (computePreference !== "No preference") answers.compute_preference = computePreference;
  const budget = Number(monthlyBudget);
  if (monthlyBudget !== "" && !isNaN(budget) && budget >= 5) {
    answers.monthly_budget = budget;
  }
  return answers;
}

// Update isValid to include budget validation:
const isValid = appName.trim().length > 0 && budgetError === null;

// Update return:
// Replace: region, setRegion,
// With: regions, setRegions, toggleRegion, monthlyBudget, setMonthlyBudget, budgetError,
```

- [ ] **Step 2: Fix all TypeScript compilation errors from the type change**

Run: `cd frontend && pnpm exec tsc --noEmit 2>&1 | head -50`

This will surface all files referencing `region` that need updating. Fix in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/PreGenForm/usePreGenForm.ts
git commit -m "feat: update PreGenAnswers types — regions[], monthly_budget, new uptime options (#51)"
```

---

## Task 3: RegionSelector component

**Files:**
- Create: `frontend/components/PreGenForm/RegionSelector.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { ALL_AWS_REGIONS, REGION_LABELS, detectRecommendedRegions, detectTimezone } from "@/lib/regionDetect";

interface RegionSelectorProps {
  regions: string[];
  onToggle: (region: string) => void;
  maxRegions?: number;
}

const MAX_REGIONS_DEFAULT = 5;

export default function RegionSelector({ regions, onToggle, maxRegions = MAX_REGIONS_DEFAULT }: RegionSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  const [filter, setFilter] = useState("");
  const recommended = detectRecommendedRegions(detectTimezone());

  const otherRegions = ALL_AWS_REGIONS.filter((r) => !recommended.includes(r));
  const filteredOther = filter
    ? otherRegions.filter((r) => r.includes(filter.toLowerCase()) || REGION_LABELS[r]?.toLowerCase().includes(filter.toLowerCase()))
    : otherRegions;

  const atLimit = regions.length >= maxRegions;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">Region</span>
        <span
          className="text-gray-600 cursor-help"
          title="The more regions you select, the higher your infrastructure costs."
        >
          (?)
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {recommended.map((region) => (
          <label
            key={region}
            className={`flex items-center gap-3 w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 cursor-pointer ${
              regions.includes(region)
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
            } ${!regions.includes(region) && atLimit ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <input
              type="checkbox"
              checked={regions.includes(region)}
              onChange={() => onToggle(region)}
              disabled={!regions.includes(region) && atLimit}
              className="sr-only"
            />
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              regions.includes(region) ? "bg-blue-500 border-blue-500" : "border-gray-600 bg-transparent"
            }`}>
              {regions.includes(region) && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-[15px] text-white">{region}</span>
            <span className="text-sm text-gray-500 ml-1">{REGION_LABELS[region]}</span>
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowOther(!showOther)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-left mt-1"
      >
        {showOther ? "Hide other regions" : "Other regions..."}
      </button>

      {showOther && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search regions..."
            className="px-3 py-2 rounded-lg bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          {filteredOther.map((region) => (
            <label
              key={region}
              className={`flex items-center gap-3 w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 cursor-pointer ${
                regions.includes(region)
                  ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                  : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)]"
              } ${!regions.includes(region) && atLimit ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                checked={regions.includes(region)}
                onChange={() => onToggle(region)}
                disabled={!regions.includes(region) && atLimit}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                regions.includes(region) ? "bg-blue-500 border-blue-500" : "border-gray-600 bg-transparent"
              }`}>
                {regions.includes(region) && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-[15px] text-white">{region}</span>
              <span className="text-sm text-gray-500 ml-1">{REGION_LABELS[region]}</span>
            </label>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        {regions.length} region{regions.length !== 1 ? "s" : ""} selected
        {atLimit && <span className="text-yellow-500 ml-2">Maximum {maxRegions} regions</span>}
      </p>
    </div>
  );
}
```

**Note:** This component is ~105 lines, within the 150-line limit. The checkbox rendering is repeated for recommended and other regions — extract a `RegionCheckbox` sub-component if it feels redundant during implementation.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd frontend && pnpm exec tsc --noEmit 2>&1 | grep -i RegionSelector || echo "clean"`

- [ ] **Step 3: Commit**

```bash
git add frontend/components/PreGenForm/RegionSelector.tsx
git commit -m "feat: add RegionSelector with timezone detection and multi-select (#51)"
```

---

## Task 4: ExpectedUsersCards component

**Files:**
- Create: `frontend/components/PreGenForm/ExpectedUsersCards.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { EXPECTED_USERS_CARDS } from "./usePreGenForm";

interface ExpectedUsersCardsProps {
  value: string;
  onChange: (v: string) => void;
}

export default function ExpectedUsersCards({ value, onChange }: ExpectedUsersCardsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide font-mono">Expected Users</span>
      <div className="flex flex-col gap-2">
        {EXPECTED_USERS_CARDS.map((card, index) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onChange(card.value)}
            className={`flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 ${
              value === card.value
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)] hover:translate-x-[3px]"
            }`}
            aria-selected={value === card.value}
            tabIndex={0}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium text-white">{card.label}</span>
              <span className="text-xs text-gray-500">{card.description}</span>
            </div>
            <span className="hidden sm:block text-xs text-gray-600 font-mono ml-4">{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PreGenForm/ExpectedUsersCards.tsx
git commit -m "feat: add ExpectedUsersCards t-shirt sizing component (#51)"
```

---

## Task 5: UptimeCards component

**Files:**
- Create: `frontend/components/PreGenForm/UptimeCards.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { UPTIME_CARDS } from "./usePreGenForm";

interface UptimeCardsProps {
  value: string;
  onChange: (v: string) => void;
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
        {UPTIME_CARDS.map((card, index) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onChange(card.value)}
            className={`flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] text-left border transition-all duration-150 ${
              value === card.value
                ? "bg-[rgb(14_24_45)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3),inset_0_0_20px_rgba(59,130,246,0.05)]"
                : "bg-[rgb(15_15_20)] border-[rgb(40_40_50)] hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)] hover:translate-x-[3px]"
            }`}
            aria-selected={value === card.value}
            tabIndex={0}
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium text-white">{card.label}</span>
                {"recommended" in card && card.recommended && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    Recommended
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500">{card.subtitle}</span>
            </div>
            <span className="hidden sm:block text-xs text-gray-600 font-mono ml-4">{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PreGenForm/UptimeCards.tsx
git commit -m "feat: add UptimeCards with real-world downtime translations (#51)"
```

---

## Task 6: ScaleResilience wrapper component

**Files:**
- Create: `frontend/components/PreGenForm/ScaleResilience.tsx`

- [ ] **Step 1: Write the wrapper**

```tsx
"use client";

import ExpectedUsersCards from "./ExpectedUsersCards";
import UptimeCards from "./UptimeCards";

interface ScaleResilienceProps {
  expectedUsers: string;
  onExpectedUsersChange: (v: string) => void;
  uptime: string;
  onUptimeChange: (v: string) => void;
}

export default function ScaleResilience({
  expectedUsers,
  onExpectedUsersChange,
  uptime,
  onUptimeChange,
}: ScaleResilienceProps) {
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-sm text-gray-400 font-medium">Scale & Resilience</h3>
      <ExpectedUsersCards value={expectedUsers} onChange={onExpectedUsersChange} />
      <UptimeCards value={uptime} onChange={onUptimeChange} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PreGenForm/ScaleResilience.tsx
git commit -m "feat: add ScaleResilience wrapper component (#51)"
```

---

## Task 7: BudgetInput component

**Files:**
- Create: `frontend/components/PreGenForm/BudgetInput.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

interface BudgetInputProps {
  value: string;
  onChange: (v: string) => void;
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
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 150"
          className="flex-1 px-[18px] py-[14px] rounded-[10px] bg-[rgb(15_15_20)] border border-[rgb(40_40_50)] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-[15px] transition-colors"
        />
        <span className="text-sm text-gray-500">/ month</span>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!error && <p className="text-xs text-gray-600">Set a target to help the AI optimize for cost.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PreGenForm/BudgetInput.tsx
git commit -m "feat: add BudgetInput optional field (#51)"
```

---

## Task 8: Update PreGenForm/index.tsx to use new components

**Files:**
- Modify: `frontend/components/PreGenForm/index.tsx`
- Delete: `frontend/components/PreGenForm/OperationalSelectors.tsx`

- [ ] **Step 1: Update imports and swap components**

In `index.tsx`:
- Remove import of `OperationalSelectors`
- Add imports: `RegionSelector`, `ScaleResilience`, `BudgetInput`
- Replace the `<OperationalSelectors ... />` block (lines 100-107) with:

```tsx
<RegionSelector
  regions={form.regions}
  onToggle={form.toggleRegion}
/>

<ScaleResilience
  expectedUsers={form.expectedUsers}
  onExpectedUsersChange={form.setExpectedUsers}
  uptime={form.uptime}
  onUptimeChange={form.setUptime}
/>

<BudgetInput
  value={form.monthlyBudget}
  onChange={form.setMonthlyBudget}
  error={form.budgetError}
/>
```

- [ ] **Step 2: Delete OperationalSelectors.tsx**

```bash
git rm frontend/components/PreGenForm/OperationalSelectors.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && pnpm exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/components/PreGenForm/index.tsx
git commit -m "feat: wire new form components, remove OperationalSelectors (#51)"
```

---

## Task 9: Update discovery page and pipeline for regions[]

**Files:**
- Modify: `frontend/app/new/page.tsx` — update `region` references to `regions`
- Modify: `frontend/app/new/discovery/useDiscoveryPage.ts` — no code change needed (passes answers as-is)
- Modify: `frontend/lib/useCanvasPipeline.ts:302-305` — answers are spread directly, so the new `regions` field flows through automatically
- Modify: `frontend/lib/generationStart.ts` — update type to accept `number` values (for `monthly_budget`)

- [ ] **Step 1: Update page.tsx**

In `frontend/app/new/page.tsx`, find any references to `answers.region` and update to `answers.regions`. Check the `sessionStorage` draft handling — the answers object is serialized as-is, so no changes needed there.

- [ ] **Step 2: Update generationStart.ts type**

Change the `answers` parameter type to accept numbers (for `monthly_budget`):
```typescript
// Old:
export async function startGenerationViaHttp(
  answers: Record<string, string | string[]>,
// New:
export async function startGenerationViaHttp(
  answers: Record<string, string | string[] | number>,
```

Note: `useDiscoveryPage.ts` already uses `Record<string, string | string[]>` — update its `DiscoveryAnswers` type to `Record<string, string | string[] | number>` as well.

- [ ] **Step 3: Verify TypeScript compiles across the frontend**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/app/new/page.tsx frontend/lib/generationStart.ts frontend/app/new/discovery/useDiscoveryPage.ts
git commit -m "feat: update /new page and pipeline for regions[] and monthly_budget types (#51)"
```

---

## Task 10: Backend — accept regions[] and monthly_budget

**Files:**
- Modify: `backend/ws_handler.py:1079-1090` (chat_discovery_start) and start_generation answers handling
- Modify: `backend/agents/requirements.py:1-63`
- Modify: `backend/agents/discovery_agent.py:14-18`
- Modify: `backend/agents/cost_analyst.py` — add monthly_budget awareness to system prompt
- Test: `backend/tests/test_ws_handler.py`
- Test: `backend/tests/agents/test_requirements.py`

- [ ] **Step 1: Update ws_handler.py chat_discovery_start handler**

At line 1082, change:
```python
# Old:
"region": str(data.get("region", "us-east-1")),

# New:
"regions": _normalize_regions(data),
```

Add helper near top of file:
```python
def _normalize_regions(data: dict[str, Any]) -> list[str]:
    """Accept both 'regions' (list) and legacy 'region' (str)."""
    regions = data.get("regions")
    if isinstance(regions, list) and all(isinstance(r, str) for r in regions):
        return regions
    region = data.get("region")
    if isinstance(region, str) and region.strip():
        return [region.strip()]
    return ["us-east-1"]
```

Also add `monthly_budget` to optional keys:
```python
for optional_key in ("compliance", "environment", "compute_preference"):
# becomes:
for optional_key in ("compliance", "environment", "compute_preference", "monthly_budget"):
```

And handle `monthly_budget` specially (as a number, not string):
```python
val = data.get("monthly_budget")
if isinstance(val, (int, float)) and val >= 5:
    discovery_answers["monthly_budget"] = val
```

Also update the `start_generation` HTTP handler. The answers dict from the client flows through `start_generation_for_user` to agents. Apply `_normalize_regions` to the answers dict before passing it to the generation pipeline — find where `answers` is extracted from the request body and normalize:
```python
# In the start_generation HTTP handler, after extracting answers:
if "region" in answers and "regions" not in answers:
    answers["regions"] = _normalize_regions(answers)
    answers.pop("region", None)
```

Add a unit test for `_normalize_regions`:
```python
# In backend/tests/test_ws_handler.py or a new test file
def test_normalize_regions_accepts_list():
    assert _normalize_regions({"regions": ["us-east-1", "eu-west-1"]}) == ["us-east-1", "eu-west-1"]

def test_normalize_regions_wraps_legacy_string():
    assert _normalize_regions({"region": "eu-west-1"}) == ["eu-west-1"]

def test_normalize_regions_defaults_on_empty():
    assert _normalize_regions({}) == ["us-east-1"]
```

- [ ] **Step 2: Update requirements.py system prompt**

Change line 13:
```python
# Old:
# - region: string (e.g. "us-east-1")
# New:
# - regions: list of strings (e.g. ["us-east-1", "eu-west-1"])
```

Update the uptime rules at line 26:
```python
# Old:
#   - uptime "Best effort" → single-AZ ok, no NAT Gateway required
# New:
#   - uptime "99.0% SLA" → single-AZ ok, no NAT Gateway required
```

Add budget rule:
```python
# - monthly_budget: number (optional) — target monthly cost in USD; influence service tier choices to stay within budget
```

Add multi-region rule:
```python
# - When regions has more than one entry, set multi_region: true and include cross-region networking (Route 53, CloudFront)
```

- [ ] **Step 3: Update discovery_agent.py**

At line 16:
```python
# Old:
region = answers.get("region", "us-east-1")
# New:
regions = answers.get("regions", answers.get("region", ["us-east-1"]))
if isinstance(regions, str):
    regions = [regions]
region_display = ", ".join(regions)
```

At line 36:
```python
# Old:
# - Region: {region}
# New:
# - Region(s): {region_display}
```

- [ ] **Step 4: Update cost_analyst.py**

Add `monthly_budget` awareness to the Cost Analyst system prompt. The agent should:
- Accept `monthly_budget` from the answers/requirements context
- When `monthly_budget` is provided and the estimated total exceeds it, include a warning in the output and suggest cheaper alternatives
- Add to the system prompt input keys: `- monthly_budget: number (optional) — user's target monthly cost in USD`
- Add to the rules: `- If monthly_budget is provided and your estimate exceeds it, add a "budget_warning" field with a brief explanation and cheaper alternatives`

- [ ] **Step 5: Update existing tests**

In `backend/tests/test_ws_handler.py`, update the `chat_discovery_start` test payloads to use `regions`:
```python
# Old:
"region": "us-east-1",
# New:
"regions": ["us-east-1"],
```

Update `questionnaire_answers` fixtures:
```python
# Old:
"questionnaire_answers": {"app_name": "Demo", "region": "us-east-1"},
# New:
"questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
```

- [ ] **Step 6: Run backend tests**

Run: `cd backend && uv run pytest tests/ -v --tb=short 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/ws_handler.py backend/agents/requirements.py backend/agents/discovery_agent.py backend/agents/cost_analyst.py backend/tests/
git commit -m "feat: backend accepts regions[] and monthly_budget (#51)"
```

---

## Task 11: Update documentation

**Files:**
- Modify: `documents/data-reference.md`
- Modify: `documents/platform-docs.md`
- Modify: `backend/CLAUDE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update data-reference.md**

Add `regions: string[]` and `monthly_budget?: number` to the questionnaire answers schema. Replace `region: string` with `regions: string[]`.

- [ ] **Step 2: Update platform-docs.md**

Update `chat_discovery_start` message type: `region` → `regions` (array). Add `monthly_budget` as optional field in both `start_generation` answers and `chat_discovery_start`.

- [ ] **Step 3: Update backend/CLAUDE.md**

Update the `chat_discovery_start` message type documentation to show `regions` instead of `region`.

- [ ] **Step 4: Update root CLAUDE.md**

In the WebSocket Message Types section, update `chat_discovery_start` to show `"regions": ["..."]` instead of `"region": "..."`. Update `PreGenAnswers` type reference if present.

- [ ] **Step 5: Commit**

```bash
git add documents/data-reference.md documents/platform-docs.md backend/CLAUDE.md CLAUDE.md
git commit -m "docs: update data contracts for regions[] and monthly_budget (#51)"
```

---

## Task 12: Frontend integration test — verify form renders and builds correct payload

- [ ] **Step 1: Manual smoke test**

Run: `cd frontend && pnpm dev`

Verify:
1. Region selector shows 3 recommended regions based on your timezone
2. First recommended region is pre-selected
3. Can select/deselect multiple regions (max 5)
4. "Other regions" expandable works with search filter
5. T-shirt sizing cards display with correct labels and descriptions
6. "Early Traction" (1K–100K/mo) is pre-selected
7. SLA uptime cards show downtime translations
8. "High Availability" shows "Recommended" badge and is pre-selected
9. Budget field is optional, shows $5 minimum error when < 5
10. Both cost tooltips (?) appear on region and uptime sections
11. Form submits correctly in fast-path and chat-first modes

- [ ] **Step 2: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: polish form redesign after smoke testing (#51)"
```
