# DrawToCloud — Style Guide

Visual and interaction design reference. The canonical palette is dark-mode-first. Light mode is planned for V2 but not yet in scope — do not build for it now, but do not hardcode assumptions that would make it impossible later (e.g. avoid `fill: white` in SVGs, prefer semantic color tokens where possible).

---

## 1. Color Palette

### Base (Dark Mode — current canonical)

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| Page background | `#030712` | `bg-gray-950` | Full-page backgrounds |
| Panel background | `#111827` | `bg-gray-900` | Sidebars, output panel, modals |
| Surface / input | `#1f2937` | `bg-gray-800` | Input fields, dropdowns, control backgrounds |
| Border default | `#374151` | `border-gray-700` | Panel dividers, card borders |
| Border subtle | `#4b5563` | `border-gray-600` | Input borders, secondary dividers |
| Text primary | `#f9fafb` | `text-white` / `text-gray-100` | Body text, labels |
| Text secondary | `#9ca3af` | `text-gray-400` | Subtitles, hints, metadata |
| Text muted | `#6b7280` | `text-gray-500` | Placeholders, empty states |

### Brand / Interactive

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| Primary action | `#2563eb` | `bg-blue-600` | Send button, CTA buttons, active states |
| Primary hover | `#3b82f6` | `hover:bg-blue-500` | Hover state for primary buttons |
| Primary focus ring | `#3b82f6` | `focus:border-blue-500` | Input focus, active selection |
| Selected surface | `#172554` | `bg-blue-950` | Multi-select option, active list item |
| Primary shadow | `#1e3a8a 30%` | `shadow-blue-900/30` | CTA button depth shadow |

### Disabled / Inactive

| Token | Tailwind | Usage |
|-------|----------|-------|
| Disabled button bg | `bg-gray-700` | Disabled send, loading states |
| Disabled text | `disabled:opacity-50` | Disabled labels |
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

---

## 2. Typography

**Base font:** System sans-serif stack — `Arial, Helvetica, sans-serif` (Next.js default, no custom font in MVP)

| Role | Classes | Usage |
|------|---------|-------|
| Page title | `text-2xl font-semibold text-white` | Panel headers, modal titles |
| Section subtitle | `text-sm text-gray-400` | Panel subtitles, descriptive labels |
| Body / chat text | `text-sm text-gray-100` | Chat messages, question prompts |
| Muted / hint | `text-sm text-gray-500` | Empty states, placeholders |
| Button label (large) | `text-lg font-semibold` | Primary CTA (Generate Architecture) |
| Button label (small) | `text-sm font-medium` | Secondary actions |
| Node label | `text-sm font-medium text-white` | Canvas node pills |

**Rules:**
- No `text-base` — use `text-sm` as the default body size
- `font-semibold` only for titles and primary CTAs; use `font-medium` for everything else
- Do not mix font families — keep the system stack until a custom font is explicitly chosen

---

## 3. Spacing & Layout

**Page layout:** `flex h-screen overflow-hidden` — no scrolling at the page level. Each panel handles its own overflow.

**Panel widths:**
- Chat panel: `w-80` (320px), fixed, `flex-shrink-0`
- Canvas: `flex-1` (fills remaining width)

**Internal panel padding:**
- Panel header: `px-4 py-3`
- Panel content: `px-4 py-4`
- Input row: `px-4 py-3`

**Gap / spacing scale:**
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

**Standard action (icon button):**
```
bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed
text-white p-2 rounded-lg transition-colors
```

**Option button (questionnaire single-select):**
```
flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-700 bg-gray-900
hover:bg-gray-800 hover:border-blue-500 transition-all text-left text-gray-200 text-sm
```

**Option button (selected state):**
```
border-blue-500 bg-blue-950 text-white
```

### Inputs

**Text input:**
```
px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white
placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors
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

**Floating card (questionnaire):**
```
max-w-2xl w-full px-6 gap-8 flex flex-col items-center
```

### Message Bubbles

**User bubble:**
```
justify-end → max-w-[85%] rounded-xl px-3 py-2 text-sm bg-blue-600 text-white
```

**Assistant bubble:**
```
justify-start → max-w-[85%] rounded-xl px-3 py-2 text-sm bg-gray-700 text-gray-100
```

### Progress Indicator (Dots)

| State | Classes |
|-------|---------|
| Answered | `w-2 h-2 rounded-full bg-blue-500` |
| Current | `w-2 h-2 rounded-full bg-blue-400 animate-pulse` |
| Future | `w-2 h-2 rounded-full bg-gray-600` |
| Loading | `w-2 h-2 rounded-full bg-gray-600 animate-pulse` |

### Canvas Controls (React Flow)

- Background: dot grid, color `#374151`, gap 24px
- Controls: `bg-gray-800 border-gray-600`
- MiniMap: `bg-gray-800 border-gray-600`, node colors from `colorForCategory`

---

## 5. Motion & Transitions

**Default transition:** `transition-all duration-300` for show/hide, `transition-colors` for hover states.

**Question fade in/out:**
```
transition-all duration-300 ease-in-out
visible:   opacity-100 translate-y-0
hidden:    opacity-0 translate-y-4
```

**Button press:**
```
active:scale-95
```

**Spin animation:** `animate-spin` — used for loading spinner (border-based, `border-t-transparent`)

**Pulse animation:** `animate-pulse` — used for progress dots during loading

**Rules:**
- Keep durations short: 200–300ms for most UI; 500ms max for full-screen transitions
- Do not animate layout changes — only opacity and transform
- No bounce or spring easings in MVP — keep it clean and professional

---

## 6. Iconography

**Library:** `lucide-react` (tree-shaken, consistent stroke weight)

Icons in use:
- Send button: `Send` (arrow)
- Settings: (planned for TICKET-002)

**Rules:**
- Always use `lucide-react` — do not mix icon libraries
- Default size: 16px (`w-4 h-4`) for inline, 20px (`w-5 h-5`) for buttons
- Icons inherit text color — do not hardcode fill

---

## 7. Dark Mode Strategy

The app is dark-mode only today. When light mode ships (V2), it will be implemented via CSS custom properties and Tailwind's `dark:` variant — not by shipping a separate component set.

**Rules for new code:**
- Prefer `bg-gray-900` over `bg-[#111827]` — use Tailwind tokens, not raw hex, for background/text
- Do not hardcode `fill: white` or `stroke: black` in inline SVGs
- Use `text-white` only for elements that are intentionally always white (e.g. text on blue buttons). For general body text, use `text-gray-100` so it can be overridden by a future light theme.
- Do not add `dark:` variants yet — the whole app is dark. We'll add them in bulk during light mode work.

---

## 8. Accessibility (MVP Minimums)

- All interactive elements must be keyboard-reachable
- Questionnaire supports full keyboard navigation (number keys + Enter)
- Focus rings: `focus:outline-none focus:border-blue-500` on all inputs
- Disabled states must set both `disabled` attribute and visual cues (`disabled:bg-gray-700 disabled:cursor-not-allowed`)
- Color is never the only signal — selected options also change border and background, not just color
