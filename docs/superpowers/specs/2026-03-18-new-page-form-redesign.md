# Redesign for /new Page Form

**Issue:** #51
**Date:** 2026-03-18
**Status:** Design approved

---

## Overview

Redesign the `/new` page pre-generation form to reduce cognitive load and improve usability for both ICPs (Resourceful Builders and Infrastructure Pragmatists). Three changes: smarter region selection, combined scale & resilience section with friendly labels, and an optional monthly budget field.

---

## 1. Region Selector

### Current State
5-button radio group selecting a single region string (`"us-east-1"`).

### New Design

**Timezone-based recommendation:** On mount, use `Intl.DateTimeFormat().resolvedOptions().timeZone` to infer the user's location. A static lookup table maps timezone prefixes (e.g., `America/*`, `Europe/*`, `Asia/*`) to the top 3 closest AWS regions. If timezone is unavailable or unrecognized, fall back to `["us-east-1"]`.

**UI:**
- 3 recommended region chips displayed as checkboxes, labeled with region ID + friendly name (e.g., "us-east-1 - N. Virginia"). The closest region is pre-checked.
- "Other regions" expandable section reveals the full list (~15 regions) as additional checkboxes with a small text filter for searching.
- Maximum 5 regions selectable. If user tries to select more, show: "Maximum 5 regions allowed."
- `(?)` tooltip next to section label: "The more regions you select, the higher your infrastructure costs."
- Dynamic counter: "X region(s) selected" below the chips.

**Data contract change:**
- `region: string` → `regions: string[]`
- Default: `[detectedClosestRegion]`

**Backward compatibility:** Backend accepts both `region` (string, legacy) and `regions` (array, new). If `region` is received, wrap it as `[region]`. Existing `questionnaire_answers` JSONB rows with `region` are handled at read time — no data migration needed.

**New files:**
- `RegionSelector.tsx` (~100 lines) — extracted from OperationalSelectors
- `lib/regionDetect.ts` — timezone-to-region mapping utility

---

## 2. Scale & Resilience (Combined Section)

### Current State
Separate "Expected Users" and "SLA Uptime" button groups in OperationalSelectors.

### New Design

A single "Scale & Resilience" section with two sub-sections.

#### Expected Users — T-Shirt Sizing Cards

4 selectable cards stacked vertically (`flex flex-col gap-2`, per styleguide). Each card:
- Bold title
- Small gray description text
- Resting: `bg-[rgb(15_15_20)]` with `border-[rgb(40_40_50)]`
- Hover: `bg-[rgb(22_22_30)]` with `border-[rgb(70_70_90)]`
- Selected: `bg-[rgb(14_24_45)]` with `border-blue-500` + box-shadow glow
- Keyboard accessible with `tabIndex`, `aria-selected`, and number key hints per styleguide Section 8

| Card Label | Description | Backend Value |
|---|---|---|
| MVP / Just exploring | Perfect for testing an idea, internal tools, or side projects with a minimal footprint. | `<1K/mo` |
| Early Traction | For growing apps with consistent early users needing reliable performance. | `1K–100K/mo` |
| Growing Business | For scaling platforms expecting steady daily traffic and needing higher capacity. | `100K–1M/mo` |
| Enterprise Scale | For high-volume, mission-critical applications requiring maximum concurrent load. | `1M+/mo` |

**Note:** Backend values use en dash (`–`, U+2013) between ranges to match existing `usePreGenForm.ts` values exactly.

Frontend displays friendly labels; backend receives the existing range strings. No backend change needed.

#### SLA Uptime — 3 Option Cards

Single row (mobile: stacked). Each card shows friendly name + real-world downtime translation.

| Card Label | Backend Value | Subtitle |
|---|---|---|
| Standard | `99.0% SLA` | Up to ~7h downtime/month |
| High Availability | `99.9% SLA` | Up to ~43min downtime/month |
| Mission Critical | `99.99% SLA` | Up to ~4min downtime/month |

- "High Availability" is pre-selected and shows a small "Recommended" badge.
- `(?)` tooltip next to section label: "Higher availability requires redundant infrastructure, increasing costs."
- Replaces "Best effort" with "Standard (99.0%)".

**New files:** Split into two if combined exceeds 150 lines:
- `ExpectedUsersCards.tsx` — t-shirt sizing cards (~70 lines)
- `UptimeCards.tsx` — SLA option cards with recommended badge (~60 lines)
- `ScaleResilience.tsx` — wrapper combining both sub-components (~30 lines)

**Removed:** `OperationalSelectors.tsx` (region → RegionSelector, scale/uptime → ScaleResilience)

---

## 3. Monthly Budget (Optional)

### New Field

Added after Scale & Resilience, before Advanced Options.

- **Label:** "Monthly Budget (optional)"
- **Input:** Numeric text input with `$` prefix and `/ month` suffix, placeholder `"e.g. 150"`
- **Validation:** If provided, minimum $5. Inline error: "Minimum budget is $5/month"
- **Empty state:** Valid — field omitted from payload
- **Helper text:** "Set a target to help the AI optimize for cost."

**Data contract change:**
- New optional field: `monthly_budget?: number` in `PreGenAnswers`
- `buildAnswers()` includes it only when value >= 5
- Passed in both `start_generation` answers and `chat_discovery_start` messages

**New file:** `BudgetInput.tsx` (~40 lines)

---

## 4. Backend Changes

Minimal changes to accept new/modified fields:

1. **`regions: string[]`** — `ws_handler.py` and agents accept `regions` (array) instead of `region` (string). For backward compatibility, if legacy `region` (string) is received, wrap as `[region]`. Requirements Agent prompt updated to understand multi-region — multiple regions means "deploy independently in each region" (not active-active replication). The agent should set `multi_region: true` when `len(regions) > 1`.
2. **`monthly_budget?: number`** — Optional field in `start_generation` answers and `chat_discovery_start`. Forwarded to Requirements Agent and Cost Analyst Agent. Cost Analyst should flag when estimated cost exceeds the budget and suggest alternatives.
3. **Uptime values** — `"Best effort"` replaced by `"99.0% SLA"` in all places: frontend options, backend defaults, and Requirements Agent prompt logic (which has special handling for "Best effort").
4. **`expected_users`** — No change.

---

## 5. File Impact Summary

| File | Action |
|---|---|
| `PreGenForm/usePreGenForm.ts` | Update types: `region` → `regions`, add `monthly_budget`, update uptime options/defaults |
| `PreGenForm/OperationalSelectors.tsx` | Delete (split into RegionSelector + ScaleResilience) |
| `PreGenForm/RegionSelector.tsx` | New — region multi-select with timezone detection |
| `lib/regionDetect.ts` | New — timezone-to-region mapping |
| `PreGenForm/ScaleResilience.tsx` | New — wrapper combining ExpectedUsersCards + UptimeCards |
| `PreGenForm/ExpectedUsersCards.tsx` | New — t-shirt sizing cards |
| `PreGenForm/UptimeCards.tsx` | New — SLA uptime option cards |
| `PreGenForm/BudgetInput.tsx` | New — optional budget input |
| `PreGenForm/index.tsx` | Update imports, swap components |
| `app/new/page.tsx` | Update type usage (`region` → `regions`) |
| `app/new/discovery/page.tsx` | Update type usage if referencing region |
| `app/new/discovery/useDiscoveryPage.ts` | Update answers spreading (`region` → `regions`) for `chat_discovery_start` |
| `lib/generationStart.ts` | Update payload type |
| `lib/useCanvasPipeline.ts` | Update `chat_discovery_start` payload construction (`region` → `regions`) |
| `backend/ws_handler.py` | Accept `regions[]` and `monthly_budget`, backward-compat for legacy `region` string |
| `backend/agents/requirements.py` | Handle `regions[]`, `monthly_budget`, and replace `"Best effort"` logic with `"99.0% SLA"` |
| `backend/agents/discovery_agent.py` | Update `answers.get("region")` → `answers.get("regions")` |
| `backend/agents/cost_analyst.py` | Accept `monthly_budget` in context, flag when estimate exceeds budget |
| `documents/data-reference.md` | Update field definitions |
| `documents/platform-docs.md` | Update form field docs, WS message schemas, `chat_discovery_start` payload |
| `backend/CLAUDE.md` | Update `chat_discovery_start` message type documentation |

---

## 6. What's NOT Changing

- `app_name` and `description` fields — unchanged
- `AiPromptHelper.tsx` — unchanged
- `AdvancedOptions.tsx` — unchanged (compliance, environment, compute preference)
- Fast path vs chat-first routing logic — unchanged
- Backend agent pipeline structure — unchanged
- Quota system — unchanged
