# DrawToCloud — Promotional Video v2

**Total duration:** ~900 frames @ 30fps (≈30 seconds)
**Resolution:** 1920×1080
**Background color (global):** `#02040c`

---

## Global Visual Language

- **Background:** `radial-gradient(ellipse at 50% 0%, rgb(15,23,42) 0%, rgb(2,4,12) 70%)`
- **Font (UI):** DM Sans, system-ui, sans-serif
- **Font (mono/code):** SF Mono, Fira Code, Cascadia Code, monospace
- **Node category colors** (canonical, from `frontend/lib/categoryColors.ts`):
  - `network` → `#3b82f6` (blue)
  - `compute` → `#f97316` (orange)
  - `database` → `#22c55e` (green)
  - `storage` → `#eab308` (yellow)
  - `security` → `#ef4444` (red)
  - `monitoring` → `#a855f7` (purple)
- **All animations MUST be driven by `useCurrentFrame()`.** CSS `transition`, `animation`, and Tailwind animation classes are FORBIDDEN.
- **Component size limit:** 150 lines per file. Split into sub-components.
- **Logic/rendering split:** animation calculations in `useXxxAnimation.ts` hooks; rendering in component files.

---

## Scene 1 — Intro (frames 0–90, 3 sec)

**Purpose:** Brand reveal. Clean, minimal, impactful.

### Layout
- Centered vertically and horizontally on a dark background.
- Two elements stacked with ~16px gap:
  1. **Headline:** `"Introducing DrawToCloud"` — 64px, font-weight 700, white, letter-spacing -0.02em
  2. **Subheadline:** `"Generate cloud infrastructure with AI"` — 22px, font-weight 400, color `#94a3b8`

### Animation
- **Headline:** fades in + slides up 20px → resting position over frames 0–24, using `spring({ damping: 28, stiffness: 120 })`.
- **Subheadline:** same motion, delayed by 14 frames (starts at frame 14).
- **Accent line:** a 2px horizontal gradient line (`#3b82f6` → `#6366f1`) 160px wide appears centered below the headline at frame 20, width animates from 0 → 160px over 20 frames.
- **Outro:** entire group fades out over frames 72–90.

---

## Scene 2 — Pre-Generation Workflow (frames 90–420, 11 sec)

**Purpose:** Show the end-to-end user workflow: open the AI helper → copy the prompt → switch to VS Code terminal with Claude → AI analyzes the codebase → copy the response → paste it back into the form → fill in the remaining fields → click Generate.

This scene is entirely animated React code — no screenshots.

### 2A. Pre-Gen Form (Phase 1, frames 0–60 local)

Faithfully recreate the `PreGenForm` UI as pixel-accurate inline-styled React. The form is centered in a 700px wide column with `gap: 20`.

#### Form header
- Title: `"New Architecture"` — 24px semibold white, centered
- Subtitle: `"4 / 5 remaining"` — 14px, color `#9ca3af`, centered, below title with 4px gap

#### Project name field
- Label: `"Project name *"` — 14px, color `#9ca3af`, margin-bottom 6px
- Input: pre-filled with `"WikiGlobe"`. Background `rgb(31,41,55)` (`gray-800`), border `rgb(55,65,81)` (`gray-700`), text white, 14px, rounded-lg, padding `10px 12px`. Height ~38px.

#### Description field
- Label: `"Describe your app"` with gray `"(optional)"` suffix
- Textarea: 3 rows, same styling as input, placeholder `"e.g. A SaaS analytics…"`. Initially empty and visible with its placeholder.
- Below the textarea: the **AiPromptHelper accordion** (see below).

#### AiPromptHelper accordion
Exact replica of `frontend/components/PreGenForm/AiPromptHelper.tsx`:
- **Toggle button** (full-width): background `rgb(17,24,39)` (`gray-900`), border `rgb(55,65,81)`, border-radius 8px top (rounded when closed), text `"Use AI to analyze your codebase"` — 14px, color `#9ca3af`. Right side: chevron-right icon (16px), color `#9ca3af`.
- **Expanded panel** (visible from frame ~14 local): background `rgba(17,24,39,0.5)`, padding 16px. Contains:
  - Instructional text: `"Copy this prompt, paste it into Claude Code or any AI with codebase access, then paste the response in the description above."` — 12px, color `#6b7280`.
  - Code preview box: background `rgb(31,41,55)`, rounded-lg, padding 12px. Shows first 180 chars of the full prompt (see PROMPT TEXT below) followed by `…`, 12px monospace, color `#d1d5db`, max-height 112px, scrollable.
  - **Copy button** (absolute top-right of preview box): background `rgb(55,65,81)`, rounded, 6px padding, `Copy` icon 14px, color `#d1d5db`. When `copyFlash=true`: background `#2563eb` (blue-600), subtle glow `0 0 8px rgba(59,130,246,0.6)`.
  - **"Copied!" tooltip**: appears when `showCopied=true` — small green pill (`#22c55e` bg) with ✓ icon, text `"Copied!"`, positioned top-right of the copy button.

**PROMPT TEXT** (the exact text shown in the preview, truncated to 180 chars + `…`):

```
You are helping me generate AWS infrastructure using DrawToCloud.

Analyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble…
```

The **full prompt** (used when the AI response is generated, and needed for copy behavior):

```
You are helping me generate AWS infrastructure using DrawToCloud.

Analyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble, no commentary — only the sections below:

WHAT IT DOES
[2-3 sentences: what the application does, who uses it, and what the core user action is]

SERVICES REQUIRED
[Bullet list of backend capabilities actually present in the code: authentication, file storage, real-time updates, background jobs, email/notifications, payments, search, etc.]

DATA LAYER
[Database type (relational / document / key-value / time-series) and why. Caching needs. Approximate data volume or growth rate if inferable. Any search requirements.]

TRAFFIC CHARACTERISTICS
[Infer from code patterns: request-driven vs event-driven, peak load indicators, real-time connection counts, batch job frequency, webhook volume.]

EXTERNAL INTEGRATIONS
[Third-party APIs, webhooks, OAuth providers, payment processors, CDN requirements, media processing. List only what is present in the code.]

COMPLIANCE SIGNALS
[Any indicators of regulated data: healthcare records (HIPAA), payment data (PCI-DSS), EU users (GDPR), government systems. Write "None detected" if not applicable.]

INFRASTRUCTURE CONSTRAINTS
[Hard requirements: multi-tenancy data isolation, VPC isolation, specific AWS services already in use, queue systems, CDN, geographic distribution.]

This output feeds directly into an AI system that generates Terraform infrastructure. Vague or incomplete answers produce generic, unusable results. Be precise.
```

#### Phase 1 animation sequence (local frames)
- **Frame 0:** form appears (full scene opacity fade-in 0→10).
- **Frame 12:** AiPromptHelper accordion begins expanding (height animates 0 → full over 14 frames via `spring`).
- **Frame 25–39:** `copyFlash=true` — copy button flashes blue.
- **Frame 31–46:** `showCopied=true` — "Copied!" tooltip visible.
- **Frame 38:** begin crossfade to IDE panel (`formOpacity` 1→0 over frames 38–54, `aiPanelOpacity` 0→1 over same range).

---

### 2B. VS Code IDE with Claude Code (Phase 2, local frames 38–222)

Faithfully recreate a VS Code window that fills the entire 1920×1080 frame. This is Phase 2 of the workflow scene. It overlaps with the form crossfade.

#### Window structure (top to bottom, left to right)
1. **Title bar** (36px tall): background `#323233`. Three traffic-light dots (red `#ff5f57`, yellow `#febc2e`, green `#28c840`), 12px circles, 14px left padding, 7px gap. Centered title: `"wikipedia-globe-dashboard — Visual Studio Code"`, 12px, color `#cccccc`.
2. **Body row** (fills remaining height): activity bar | file explorer | editor+terminal columns.

**Activity bar** (48px wide, `#333333`): 4 SVG icons (files, search, git, extensions) stacked with 14px gap, first icon highlighted `#cccccc`, rest `#6e6e6e`.

**File explorer** (195px wide, `#252526`, right border `1px solid #3c3c3c`):
- Header: `"EXPLORER"`, 11px, `#bbbbbe`, uppercase, letter-spacing 0.08em.
- Tree: `▾ wikipedia-globe` → `▾ src` → files (`main.py` highlighted blue `#094771`, `ingest.py`, `worker.js`, `schema.sql`), `▾ frontend` → (`globe.tsx`, `hooks.ts`), (`package.json`, `.env.example`).

**Editor pane** (flex: 1, column direction):
- **Tab bar** (35px, `#2d2d2d`, bottom border `#3c3c3c`): tabs `🐍 main.py` (active, `#1e1e1e` bg, top border `#0078d4`) and `ingest.py` (inactive).
- **Code editor** (238px tall, `#1e1e1e`): shows 12 lines of Python FastAPI code (same as current `WorkflowAIPanel.tsx` CODE array — lines 1-12).
- **Terminal panel** (flex: 1, min 300px):
  - Tab bar (32px, `#252526`): `TERMINAL` (active, white, bottom border), `OUTPUT`, `DEBUG CONSOLE` — 11px.
  - **Terminal content area**: switches between startup screen and active Claude session.

#### Terminal: Startup screen (local frames 54–84, ~1 second)

Shows the authentic Claude Code CLI startup screen:
- Shell prompt line: `○ pelazas@mac drawtocloud % claude` (gray/white, mono 13px)
- Gap, then the Claude Code pixel-art logo: orange block-pixel art ~42×42px, 6px per pixel block, color `#d97706`.
- To the right of the logo: **"Claude Code"** 16px bold `#d97706` (DM Sans); below it: `"Sonnet 4.6 · Claude Pro"` 12px `#6b7280`; below: `"~/Desktop/drawtocloud"` 12px `#6b7280`.
- Horizontal divider line (`#3c3c3c`).
- `> ▌` — gray `>`, then blinking block cursor (white `#d4d4d4` rectangle 8×14px).
- Spacer, then another divider.
- Footer row: `"? for shortcuts"` left, `"● medium · /effort"` right, 11px `#6b7280` (DM Sans).

#### Terminal: Active Claude session (local frame 84 onward)

At frame 84, the startup screen is replaced instantly (no transition) by the active session:
- **Prompt line** (fades in frames 84–96): `pelazas@mbp` (teal `#4ec9b0`) `:` (`#d4d4d4`) `~/wikipedia-globe` (blue `#569cd6`) ` $ claude` (`#d4d4d4`)
- **Claude header** (same fade): `✦ claude-sonnet-4-6 · codebase analysis` — 12px, green `#6a9955` (DM Sans)
- **Human turn** (same fade): `Human:` (blue `#569cd6`) ` You are helping me generate AWS infrastructure using DrawToCloud. Analyze my codebase…` — 12px `#9ca3af` (DM Sans)
- **AI response** (types in from frame 96 to 211, ~2300 chars ÷ 115 frames): full 7-section structured response (see AI_RESPONSE below). `▋` block cursor at end while typing.

**AI_RESPONSE text:**

```
WHAT IT DOES
This application streams live Wikipedia edit events, filters for high-signal human edits, enriches each edit with AI-generated topic and geography, and visualizes the results on a real-time globe dashboard. It is used by viewers/analysts who want to monitor global knowledge activity as it happens. The core user action is opening the dashboard to watch incoming edits in real time and interactively filter by topic and geography trends.

SERVICES REQUIRED
- Real-time data delivery to clients (database change subscriptions / pub-sub) for live edit inserts.
- Event-driven ingestion pipeline for continuous upstream stream consumption (Wikimedia SSE) and forwarding.
- Stateless enrichment API endpoint for ingest requests (POST ingest endpoint).
- Background processing for AI enrichment (geotag + category classification per event).
- Managed relational database persistence for enriched events.
- Scheduled background cleanup jobs for retention (daily purge; optional weekly compaction/leaderboard pruning).
- Leaderboard/query service for recent top edits (7-day ranked view).

DATA LAYER
Relational database is required (PostgreSQL): structured tabular event records with constraints, indexes, ordering by time, and a weekly ranking view, plus one JSON/raw payload column. Caching is not explicitly implemented; optional short-TTL cache for hot reads could reduce repeated query load. Growth is continuous/append-heavy from a live stream with 30-day retention and frontend windows up to 5,000 recent events per hour view.

TRAFFIC CHARACTERISTICS
Primary backend load is event-driven: a long-lived SSE consumer continuously receives upstream events and emits filtered candidates to the ingest API. User traffic is read-heavy on initial page load plus persistent realtime subscriptions (one live channel per connected client session). Batch frequency includes a daily retention purge (03:00) and optional weekly cleanup job.

EXTERNAL INTEGRATIONS
- Wikimedia EventStreams SSE: https://stream.wikimedia.org/v2/stream/recentchange
- Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct) for enrichment
- Supabase: Postgres storage, Realtime postgres_changes subscriptions, REST API with service-role key
- DiceBear avatar API for live editor marker avatars

COMPLIANCE SIGNALS
None detected. Stored fields are public Wikipedia edit metadata plus AI-derived category/geography.

INFRASTRUCTURE CONSTRAINTS
- Hard dependency on Supabase-compatible PostgreSQL + Realtime semantics with service-role credentials.
- Hard dependency on Cloudflare Worker-style ingest with AI inference binding.
- Continuous outbound egress required to Wikimedia stream, Supabase endpoints, and public APIs.
- Requires secure secret management for SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, and CLOUDFLARE credentials.
```

#### Selection + copy (local frames 211–242)

At frame 211, typing ends. An **I-beam selection effect** sweeps across the AI response text:
- A blue highlight `rgba(56,139,253,0.22)` grows from `width: 0%` to `width: 100%` of the response area over frames 211–226.
- A thin 2px `#4da8ff` vertical bar (I-beam cursor) tracks the right edge of the selection at `left: calc(${selectionFraction * 100}% - 1px)`.
- At frame 228, a **"Copied to clipboard"** tooltip appears: green `#238636` background, white text, `✓` checkmark icon, positioned top-right. Visible through frame 242.

---

### 2C. Back to Form + Fill In (Phase 3, local frames 206–330)

Crossfade back to the form: `aiPanelOpacity` 1→0, `formOpacity` 0→1 over frames 206–222.

#### Description paste (frame 260)
At exactly frame 260, `description` snaps from `""` to the full `AI_RESPONSE` text — **no fade, no transition**. It appears as if pasted. The textarea is visible and scrollable; the text is 12px mono `#f3f4f6`, full opacity.

Meanwhile, a **mouse cursor arrow SVG** is visible and moving:
- Frames 246–260: cursor travels from approx `(1200, 580)` to `(800, 320)` — the center of the description textarea — using `interpolate` with `Easing.inOut(Easing.quad)`.
- At frame 260: cursor applies a brief scale-down pulse (`scale(0.75)`) simulating a click, returns to `scale(1)` by frame 264.
- Cursor disappears at frame 264.

The cursor is a white arrow SVG path with a dark stroke, `width: 24 height: 24`, with `filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6))`.

#### Form scroll + field selection (frames 246–330)

The form container scrolls down via `translateY` to reveal the Scale & Resilience section and Budget:

| Local frame range | Action |
|---|---|
| 246–258 | `scrollY` animates 0 → -300px (reveals Expected Users + Uptime) |
| 260–272 | `scrollY` continues -300 → -410px (reveals Budget + Generate button) |
| 274 | `selectedUsers` snaps to `"MVP / Just exploring"` (card highlights blue) |
| 284 | `selectedUptime` snaps to `"Standard"` (card highlights blue) |
| 290–298 | Budget digits type in: `"50"` (2 chars over 8 frames) |
| 298 | **Generate button** press — `spring` scale 1 → 0.94 → 1 |
| 305 | `isGenerating=true` — button shows spinner |
| 296+ | **Sparks burst** from button center |

#### Expected Users cards (exact visual spec from `ExpectedUsersCards.tsx`)

Four cards in a 2×2 grid, each `px-[18px] py-[14px] rounded-[10px]`:
- **Unselected:** background `rgb(15,15,20)`, border `rgb(40,40,50)`
- **Selected:** background `rgb(14,24,45)`, border `#3b82f6`, box-shadow `0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)`
- Cards (label / description / value):
  1. `"MVP / Just exploring"` / `"Perfect for testing an idea…"` / `"<1K/mo"` ← **this one gets selected**
  2. `"Early Traction"` / `"For growing apps…"` / `"1K–100K/mo"`
  3. `"Growing Business"` / `"For scaling platforms…"` / `"100K–1M/mo"`
  4. `"Enterprise Scale"` / `"For high-volume…"` / `"1M+/mo"`

#### Uptime cards (exact visual spec from `UptimeCards.tsx`)

Three full-width cards stacked:
- **Unselected:** same dark styling as above
- **Selected:** same blue glow as above
- Cards (label / subtitle / value / recommended):
  1. `"Standard"` / `"Up to ~7h downtime/month"` / `"99.0% SLA"` ← **this one gets selected**
  2. `"High Availability"` / `"Up to ~43min downtime/month"` / `"99.9% SLA"` — has `Recommended` blue pill badge
  3. `"Mission Critical"` / `"Up to ~4min downtime/month"` / `"99.99% SLA"`

#### Budget input (exact visual spec from `BudgetInput.tsx`)
- Label: `"Monthly Budget (optional)"` — 14px `#9ca3af`
- Row: `$` prefix (14px `#6b7280`), number input `px-[18px] py-[14px] rounded-[10px]` background `rgb(15,15,20)`, border `rgb(40,40,50)`, white text, `/ month` suffix.
- Helper text: `"Set a target to help the AI optimize for cost."` — 12px `#4b5563`

#### Generate button
Full-width, `py-3 rounded-xl text-lg font-semibold`, gradient `from-blue-600 to-indigo-600` → `from-blue-500 to-indigo-500`, text white, shadow `shadow-blue-900/30`. Label: `"Generate Architecture"`.

---

## Scene 3 — Live Canvas + Output Panel (frames 420–660, 8 sec)

**Purpose:** Cinematic reveal of the generated AWS architecture building node by node on the React Flow canvas, followed by a split showing the Terraform code and cost estimate.

### 3A. Canvas builds (local frames 0–180)

**Camera feel:** wide, slightly zoomed-out view. The canvas takes the full 1920×1080. Dark background `#02040c`. A subtle dot-grid pattern (every 28px, dots 1.5px, color `rgba(255,255,255,0.04)`).

#### Nodes

Recreate `ServiceNode` from `frontend/components/Canvas/ServiceNode.tsx`:
- Container: 100px wide, `bg-gray-900` (`#111827`), `rounded-lg`, `p-3` (12px), border `border-gray-700` (`#374151`).
- **Left accent border:** 2px solid, colored by category (see color table above).
- **Selected state:** border `#3b82f6`, box-shadow `0 0 0 1px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.05)`.
- **Icon area:** centered, 28×28px icon. Use SVG icons appropriate to the service — simple outlines, colored with the category color.
- **Label:** 12px `#e5e7eb`, centered, leading-tight, break-words.

Recreate `ContainerNode` from `frontend/components/Canvas/ContainerNode.tsx`:
- Full-width/height dashed border, `border-2 border-dashed rounded-xl`.
- Border color: `#3b82f6` + `99` alpha (semi-transparent blue).
- Background: `rgba(59,130,246,0.04)`.
- Top-left label: 12px font-mono, `#60a5fa` (blue-400), uppercase, tracking-widest.

#### Architecture to build (8 nodes + 1 container + 7 edges)

**Container (VPC):** label `"VPC"`, category `network`. Large dashed rectangle covering approximately the center 1200×700px of canvas.

**Service nodes** (appear sequentially with staggered spring entrances, spring config `{ damping: 12, stiffness: 200, mass: 0.8 }`):

| # | Label | Category | Color | Canvas position (approx) |
|---|---|---|---|---|
| 1 | Internet Gateway | network | `#3b82f6` | top-center |
| 2 | Application Load Balancer | compute | `#f97316` | upper-center inside VPC |
| 3 | ECS Fargate | compute | `#f97316` | center-left inside VPC |
| 4 | RDS PostgreSQL | database | `#22c55e` | center-right inside VPC |
| 5 | ElastiCache | database | `#22c55e` | lower-right inside VPC |
| 6 | S3 Bucket | storage | `#eab308` | outside VPC, right side |
| 7 | CloudWatch | monitoring | `#a855f7` | outside VPC, lower-right |
| 8 | IAM Role | security | `#ef4444` | outside VPC, bottom |

**Edges** (animate as SVG paths with `strokeDashoffset` draw-in, after both endpoints exist):

| From | To | Label |
|---|---|---|
| Internet Gateway | Application Load Balancer | routes to |
| Application Load Balancer | ECS Fargate | forwards to |
| ECS Fargate | RDS PostgreSQL | reads/writes |
| ECS Fargate | ElastiCache | caches |
| ECS Fargate | S3 Bucket | stores files |
| CloudWatch | ECS Fargate | monitors |
| IAM Role | ECS Fargate | authorizes |

**Stagger timing:** Each node appears 12 frames after the previous. The VPC container appears first at local frame 0 (fade in 0→12). Nodes 1–8 appear at frames 12, 24, 36, 48, 60, 72, 84, 96. Each edge draws in 8 frames after its source node appears.

**Node entrance animation:** scale from 0 → 1 + slight Y offset -10 → 0, using spring. Nodes also have a brief glow pulse on entrance: `box-shadow` from `0 0 16px [categoryColor]60` → none over 20 frames after entrance.

#### After architecture completes (local frame ~108–180)

Hold for ~2 seconds showing the full architecture. Camera gently pans/scales slightly (transform scale 1.0 → 1.04 over 60 frames, then back) to give a "zoom breathe" cinematic feel.

---

### 3B. Output panel slides in (local frames 150–330)

At frame 150, split the screen:
- Canvas shrinks to left 60% of the screen (width: 60%, same height).
- Output panel slides in from the right, occupying right 40%.

**Output panel** — dark card, background `#0d1117`, border-left `1px solid #21262d`:

#### Terraform tab (frames 150–240)

Header: two tabs — `"Terraform"` (active, white, underline `#3b82f6`) | `"Cost Estimate"` (inactive `#6b7280`). 14px DM Sans.

Below: a code editor mock. Background `#161b22`. Line numbers `#484f58`, code text `#e6edf3`, 13px mono, line-height 20px.

Show a realistic `main.tf` excerpt (≈20 lines), with syntax colors:
- Resource keywords: `#ff7b72` (red)
- String values: `#a5d6ff` (light blue)
- Identifiers: `#79c0ff` (blue)
- Comments: `#8b949e` (gray)
- Numbers: `#f0883e` (orange)

**Typewriter animation:** code types in from frame 150 to frame 220 at ~30 chars/frame. Example content:

```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "wikiglobe-vpc" }
}

resource "aws_ecs_cluster" "app" {
  name = "wikiglobe-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_db_instance" "postgres" {
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.medium"
  allocated_storage = 20
}
```

#### Cost Estimate tab (frames 240–330)

Tab switches to `"Cost Estimate"` at frame 240 (tab indicator slides with spring).

Show a cost breakdown panel:
- **Total monthly estimate** (large): `"$47 / month"` — 32px bold white, centered. Animates from `"$0"` → `"$47"` counting up over frames 240–270.
- Below: breakdown table (each row fades + slides in staggered 8 frames apart):

| Service | Cost/mo |
|---|---|
| ECS Fargate (2 tasks × 0.25 vCPU) | `$18.40` |
| RDS PostgreSQL (db.t3.medium) | `$15.20` |
| Application Load Balancer | `$6.80` |
| ElastiCache (cache.t3.micro) | `$4.10` |
| S3 + data transfer | `$1.60` |
| CloudWatch logs | `$0.90` |

- Row styling: left text `#9ca3af` 13px, right text white 13px mono. Subtle bottom border `#21262d`. On entrance: row slides up 8px from below.
- At frame 290: a green pill badge appears: `"Within budget ✓"` — background `rgba(34,197,94,0.1)`, border `rgba(34,197,94,0.3)`, text `#22c55e`, 12px.

---

## Scene 4 — Outro / CTA (frames 660–750, 3 sec)

**Purpose:** Close with brand identity and a clear CTA.

### Layout
- Full dark screen, centered column, gap 12px:
  1. Small eyebrow: `"DrawToCloud"` — 14px, `#3b82f6`, letter-spacing 0.15em, font-mono, uppercase
  2. **Headline:** `"Draw to Cloud"` — 72px, font-weight 800, white, letter-spacing -0.03em
  3. **Subheadline:** `"5 generations free. No credit card."` — 22px, color `#94a3b8`
  4. **CTA pill:** `"Try now →"` — rounded-full, gradient `from-blue-500 to-indigo-500`, white text 18px semibold, px-8 py-3, subtle shadow `0 0 24px rgba(99,102,241,0.4)`.

### Animation
- All four elements enter with the same spring entrance (scale 0.92 → 1 + fade 0 → 1), staggered 12 frames apart starting at local frame 0.
- CTA pill pulses gently: scale 1 → 1.03 → 1 over 60 frames, looping. Use `Math.sin(frame * 0.1) * 0.015 + 1` for scale.
- **Background:** a soft radial glow centered at 50% 60% — `rgba(99,102,241,0.08)` — slowly expands from radius 200px → 400px over the full outro.
- Fade out over frames 720–750.

---

## Composition Registration (`Root.tsx`)

```tsx
<Composition
  id="DrawToCloudPromo2"
  component={DrawToCloudPromo2}
  durationInFrames={750}
  fps={30}
  width={1920}
  height={1080}
/>
```

---

## File Structure

```
src/
  DrawToCloudPromo2/
    index.tsx                  # Series of 4 scenes
    SceneIntro.tsx             # Scene 1
    SceneWorkflow.tsx          # Scene 2 orchestrator
    WorkflowFormHeader.tsx     # Form header + description + AI helper
    WorkflowFormCards.tsx      # Scale/uptime/budget/generate cards
    WorkflowAIPanel.tsx        # Full VS Code IDE mock
    WorkflowIDEStartup.tsx     # Claude Code startup screen
    WorkflowSparks.tsx         # Spark burst effect on Generate
    useWorkflowAnimation.ts    # All timing + animation values for Scene 2
    SceneCanvas.tsx            # Scene 3A: live canvas
    CanvasNode.tsx             # ServiceNode replica
    CanvasContainer.tsx        # ContainerNode replica
    SceneOutputPanel.tsx       # Scene 3B: terraform + cost panel
    SceneOutro.tsx             # Scene 4
```

---

## Implementation Notes

1. **No CSS transitions or Tailwind animation classes.** Every animated value must derive from `useCurrentFrame()`.
2. **Spring configs:**
   - Smooth UI (buttons, panels): `{ damping: 28, stiffness: 120 }`
   - Bouncy node entrances: `{ damping: 12, stiffness: 200, mass: 0.8 }`
   - Button press: `{ damping: 8, stiffness: 400 }`
3. **`premountFor={fps}`** on every `<Series.Sequence>` to avoid pop-in.
4. **TypeScript strict mode** is enabled (`noUnusedLocals: true`). Every declared variable must be used.
5. **Component size:** if any component exceeds 150 lines, split it.
6. **Local frames:** each scene component receives local frame from Remotion's `useCurrentFrame()` (already relative within a `<Sequence>`). No need to subtract offsets.
7. **Easing imports:** import `Easing` from `"remotion"` — do not use `@remotion/easing`.
