# DrawToCloud — Style Guide

Visual and interaction design reference. The canonical palette is dark-mode-first. Light mode is planned for V2 but not yet in scope — do not build for it now, but do not hardcode assumptions that would make it impossible later (e.g. avoid `fill: white` in SVGs, prefer semantic color tokens where possible).

---

## 1. Color Palette

### Base (Dark Mode — current canonical)

| Token | Hex / RGB | Tailwind | Usage |
|-------|-----------|----------|-------|
| Page background | `#02040c` | `bg-[#02040c]` | Full-page backgrounds |
| Questionnaire bg | `radial-gradient(ellipse at 50% 0%, rgb(15 23 42) 0%, rgb(2 4 12) 70%)` | inline `style` | Questionnaire overlay only |
| Panel background | `#111827` | `bg-gray-900` | Sidebars, output panel, modals |
| Surface / input | `#1f2937` | `bg-gray-800` | Chat inputs, dropdowns |
| Option card resting | `rgb(15 15 20)` | `bg-[rgb(15_15_20)]` | Single/multi-select option cards |
| Option card hover | `rgb(22 22 30)` | `bg-[rgb(22_22_30)]` | Card hover state |
| Option card selected | `rgb(14 24 45)` | `bg-[rgb(14_24_45)]` | Card selected state (blue tint) |
| Border default | `#374151` | `border-gray-700` | Panel dividers |
| Border card resting | `rgb(40 40 50)` | `border-[rgb(40_40_50)]` | Option card borders at rest |
| Border card hover | `rgb(70 70 90)` | `border-[rgb(70_70_90)]` | Option card borders on hover |
| Text primary | `#f9fafb` | `text-white` / `text-gray-100` | Body text, labels |
| Text secondary | `#9ca3af` | `text-gray-400` | Brand bar, subtitles |
| Text muted | `#6b7280` | `text-gray-500` | Question subtitles, placeholders |
| Text disabled | `#4b5563` | `text-gray-600` | Keyboard hints, progress counter |

### Brand / Interactive

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| Primary action | `#2563eb` | `bg-blue-600` | Send button, CTA buttons, active states |
| Primary hover | `#3b82f6` | `hover:bg-blue-500` | Hover state for primary buttons |
| Primary focus ring | `#3b82f6` | `focus:border-blue-500` | Input focus, active selection |
| Primary gradient (start) | `#2563eb` | `from-blue-600` | Gradient CTAs (landing + hero only) |
| Primary gradient (end) | `#4f46e5` | `to-indigo-600` | Gradient CTAs (landing + hero only) |
| Secondary accent (teal) | `#2DD4BF` | `text-teal-400` | Secondary highlight for interactive accents (sparingly) |
| Card selected border | `rgb(59 130 246)` | `border-blue-500` | Selected option card border |
| Card selected glow | `rgba(59,130,246,0.3)` | inline box-shadow | `0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)` |
| Progress bar fill | `#3b82f6` | `bg-blue-500` | Top-of-viewport progress line |
| Primary shadow | `#1e3a8a 30%` | `shadow-blue-900/30` | CTA button depth shadow |

### Disabled / Inactive

| Token | Tailwind | Usage |
|-------|----------|-------|
| Disabled opacity | `disabled:opacity-40` | Disabled buttons (questionnaire uses 40, not 50) |
| Disabled cursor | `disabled:cursor-not-allowed` | Non-interactive elements |

### Node Category Colors (Canvas)

These are fixed hex values, not Tailwind classes — used directly in React Flow node backgrounds and MiniMap.

| Category | Hex | Represents |
|----------|-----|-----------|
| `network` | `#3b82f6` | VPC, subnets, route tables |
| `compute` | `#f97316` | EC2, ECS, Lambda, ALB |
| `database` | `#22c55e` | RDS, DynamoDB, ElastiCache |
| `storage` | `#eab308` | S3, EFS |
| `security` | `#ef4444` | IAM, Security Groups, WAF |
| `monitoring` | `#a855f7` | CloudWatch, SNS |
| `default` | `#6b7280` | Unknown / uncategorized |

Source of truth: `frontend/lib/categoryColors.ts`. Never inline these values elsewhere — always import `colorForCategory`.

### Container Type Colors (Canvas)

These are fixed hex values used for nested infrastructure containers.

| Container Type | Hex | Represents |
|----------------|-----|------------|
| `vpc` | `#3b82f6` | VPC container |
| `az` | `#6366f1` | Availability Zone container |
| `subnet` | `#14b8a6` | Subnet container |

Source of truth: `frontend/lib/categoryColors.ts` and `frontend/components/Canvas/containerNodeStyles.ts`.

---

## 2. Typography

**Base font:** `"DM Sans", system-ui, sans-serif` — imported from Google Fonts in `globals.css`.

| Role | Classes | Usage |
|------|---------|-------|
| Question title | `text-2xl md:text-3xl font-medium tracking-tight text-white` | Questionnaire question prompts |
| Question subtitle | `text-sm text-gray-500` | Descriptor line under question title |
| Page / panel title | `text-2xl font-semibold text-white` | Panel headers, modal titles |
| Section subtitle | `text-sm text-gray-400` | Panel subtitles, descriptive labels |
| Option card label | `text-[15px] font-normal text-gray-200` | Single/multi-select option text |
| Body / chat text | `text-sm text-gray-100` | Chat messages |
| Muted / hint | `text-sm text-gray-500` | Empty states, placeholders |
| Keyboard hint | `text-xs text-gray-600 font-mono` | Option card keyboard shortcut (right-aligned) |
| Progress counter | `text-xs text-gray-600 tracking-widest uppercase font-mono` | "Question X of N" label |
| Brand wordmark | `text-sm font-medium text-gray-400 tracking-wide` | "draw**to**cloud" in brand bar |
| Button label (large) | `text-lg font-semibold` | Primary CTA (Generate Architecture) |
| Button label (small) | `text-sm` | Secondary actions (Next →, Continue →) |
| Node label | `text-sm font-medium text-white` | Canvas node pills |

**Rules:**
- Default body size is `text-sm`; option cards use `text-[15px]` for slightly more presence
- `font-medium` for titles; `font-normal` for option labels; `font-semibold` only for primary CTAs
- `font-mono` for keyboard hints and progress counter — signals "developer tool"
- Do not mix font families — DM Sans everywhere except `font-mono` utility classes

---

## 3. Spacing & Layout

**Page layout:** `flex h-screen overflow-hidden` — no scrolling at the page level. Each panel handles its own overflow.

**Questionnaire layout:**
- Outer: `min-h-screen` with radial gradient background
- Content column: `max-w-lg w-full` — narrower than before for a more focused feel
- Vertical centering: `flex min-h-screen items-center justify-center px-4 pt-16`
- `pt-16` accounts for the fixed brand bar height

**Panel widths:**
- Chat panel: `w-80` (320px), fixed, `flex-shrink-0`
- Canvas: `flex-1` (fills remaining width)

**Internal panel padding:**
- Panel header: `px-4 py-3`
- Panel content: `px-4 py-4`
- Input row: `px-4 py-3`

**Option card padding:** `px-[18px] py-[14px]` — slightly more generous than standard inputs

**Gap / spacing scale:**
- Between option cards: `gap-2`
- Between form elements: `gap-3`
- Between sections: `gap-6` or `gap-8`
- Message list: `space-y-3`

**Border separators:** Use `border-r`, `border-t`, `border-b` with `border-gray-700`. Never use box shadows to separate panels.

---

## 4. Components

### Buttons

**Primary (CTA):**
```
px-8 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95
text-white text-lg font-semibold transition-all shadow-lg shadow-blue-900/30
```

**Primary (CTA, gradient — landing/hero only):**
```
px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600
hover:from-blue-500 hover:to-indigo-500 active:scale-95
text-white text-lg font-semibold transition-all shadow-lg shadow-blue-900/30
```

**Standard action (icon button):**
```
bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed
text-white p-2 rounded-lg transition-colors
```

**Option button (single-select, resting):**
```
flex items-center justify-between w-full px-[18px] py-[14px] rounded-[10px] text-left
border border-[rgb(40_40_50)] bg-[rgb(15_15_20)]
hover:bg-[rgb(22_22_30)] hover:border-[rgb(70_70_90)] hover:translate-x-[3px]
transition-all duration-150
```

**Option button (selected state):**
```
background: rgb(14 24 45)
border: 1px solid rgb(59 130 246)
box-shadow: 0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)
```

**Option button click pulse:**
Apply `scale-[0.98]` for 100ms on click, then fire the action. Implemented in `OptionButton.tsx`.

**Confirm / secondary action:**
```
px-6 py-[11px] rounded-[10px] bg-blue-600 hover:bg-blue-500
disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors text-sm
```

### Inputs

**Questionnaire text input:**
```
px-[18px] py-[14px] rounded-[10px] bg-[rgb(15_15_20)] border border-[rgb(40_40_50)]
text-white placeholder-gray-600 focus:outline-none focus:border-blue-500
text-[15px] transition-colors
```

**Chat input:**
```
flex-1 bg-gray-800 text-white text-sm rounded-lg px-3 py-2
border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500
```

### Cards / Panels

**Full-height side panel:**
```
flex flex-col h-full bg-gray-900 border-r border-gray-700
```

**Glass surface (overlays + landing feature cards):**
Use for overlays like MiniMap / activity feed / selection bars, and for landing-page feature cards.
```
bg-black/30 backdrop-blur-md border border-white/5 rounded-xl
shadow-lg shadow-black/30
```

**Questionnaire content column:**
```
w-full max-w-lg
```
Cards stack vertically with `flex flex-col gap-2` — not a 2-column grid.

### Brand Bar

Fixed header present on all questionnaire screens:
```tsx
<header className="fixed top-0 left-0 right-0 z-40 px-6 py-4 flex items-center">
  <span className="text-sm font-medium text-gray-400 tracking-wide">
    draw<span className="text-white">to</span>cloud
  </span>
</header>
```
The "to" in the wordmark is always `text-white`; the rest is `text-gray-400`.

### Progress Bar

Replaces the old dot indicator. Two parts:

**Top line (viewport-fixed):**
```tsx
<div className="fixed top-0 left-0 right-0 h-[2px] bg-gray-900 z-50">
  <div
    className="h-full bg-blue-500 transition-all duration-500 ease-out"
    style={{ width: `${(current / total) * 100}%` }}
  />
</div>
```

**Counter label:**
```
text-xs text-gray-600 text-center mb-6 tracking-widest uppercase font-mono
```
Text: `Question {current + 1} of {total}` — or `"Tailoring questions…"` during loading.

The old dot-based indicator (`w-2 h-2 rounded-full`) is removed and must not be reintroduced.

### Message Bubbles

**User bubble:**
```
justify-end → max-w-[85%] rounded-xl px-3 py-2 text-sm bg-blue-600 text-white
```

**Assistant bubble:**
```
justify-start → max-w-[85%] rounded-xl px-3 py-2 text-sm bg-gray-700 text-gray-100
```

### Canvas Controls (React Flow)

- Background: dot grid, color `#374151`, gap 24px
- Controls: `bg-gray-800 border-gray-600`
- MiniMap (premium overlay):
  - Prefer glass surface styling over solid gray: `bg-black/30 backdrop-blur-md border border-white/5 shadow-lg shadow-black/30`
  - Node colors from `colorForCategory` at reduced opacity
  - Viewport indicator uses primary blue at ~30% opacity
- Overlay panels (e.g. activity feed): same glass surface styling for a consistent “premium” feel

---

## 5. Motion & Transitions

**Default transition:** `transition-all duration-300` for show/hide, `transition-colors` for hover states.

**Question fade in/out (visibility toggle):**
```
transition-all duration-300
visible:   opacity-100 translate-y-0
hidden:    opacity-0 translate-y-4
```

**Option card hover slide:**
```
hover:translate-x-[3px]   /* 3px right on hover — subtle, feels alive */
transition-all duration-150
```

**Option button click pulse:**
```
scale-[0.98] for 100ms on mousedown, then fires action
```

**Progress bar fill:**
```
transition-all duration-500 ease-out   /* smooth fill as questions advance */
```

**Button press:**
```
active:scale-95
```

**Spin animation:** `animate-spin` — used for loading spinner (border-based, `border-t-transparent`)

**Plugin:** `tailwindcss-animate` is installed and configured in `tailwind.config.ts`. Use `animate-in fade-in slide-in-from-bottom-4 duration-300` for component mount animations.

**Rules:**
- Keep durations short: 150ms for hover, 300ms for show/hide, 500ms max for full-screen transitions
- Do not animate layout changes — only opacity, transform, and color
- No bounce or spring easings in MVP — keep it clean and professional
- Prefer “scripted” hero demo animations (node/edge reveals) over continuous motion; always respect `prefers-reduced-motion`

---

## 6. Iconography

**Library:** `lucide-react` (tree-shaken, consistent stroke weight)

Icons in use:
- Send button: `Send` (arrow)
- Settings tab: `Settings` (for BYOK/provider/API key settings)

**Rules:**
- Always use `lucide-react` — do not mix icon libraries
- Default size: 16px (`w-4 h-4`) for inline, 20px (`w-5 h-5`) for buttons
- Icons inherit text color — do not hardcode fill

---

## 7. Dark Mode Strategy

The app is dark-mode only today. When light mode ships (V2), it will be implemented via CSS custom properties and Tailwind's `dark:` variant — not by shipping a separate component set.

**Rules for new code:**
- Use Tailwind tokens where available (`bg-gray-900`, `text-gray-500`, etc.)
- Raw RGB values (`bg-[rgb(15_15_20)]`) are acceptable for non-standard surfaces like option cards — document them here when introduced
- Do not hardcode `fill: white` or `stroke: black` in inline SVGs
- Use `text-white` only for elements that are intentionally always white. For general body text, use `text-gray-100`
- Do not add `dark:` variants yet — the whole app is dark

---

## 8. Accessibility (MVP Minimums)

- All interactive elements must be keyboard-reachable
- Questionnaire supports full keyboard navigation: number keys 1–N select options, Enter confirms multi-select and free-text
- Keyboard hints (the `1`, `2`, `3`… labels) are hidden on touch devices (`hidden sm:block`) — they convey no information that isn't already available via tap
- Focus rings: `focus:outline-none focus:border-blue-500` on all inputs
- Disabled states must set both `disabled` attribute and visual opacity (`disabled:opacity-40`)
- Color is never the only signal — selected option cards change border, background, and box-shadow, not just color

---

## 9. Landing Page (Marketing) Guidelines

These guidelines are based on competitive UI/UX research for AI-powered cloud architecture tools.

**Layout (recommended order):**
1. Sticky navigation (logo left, CTAs right)
2. Hero with **canvas-first** preview above the fold
3. Social proof strip (stars/logos/beta messaging)
4. How it works
5. Feature showcase (diagram + Terraform side-by-side or clear toggle)
6. BYOK / privacy messaging (differentiator)
7. Personas / use cases
8. Final CTA + footer

**Visual patterns:**
- Dark mode default, blue/indigo accents
- Gradient CTAs are allowed (and recommended) for the landing hero primary button
- Glass surfaces for feature cards and overlays (subtle blur + translucent background)
