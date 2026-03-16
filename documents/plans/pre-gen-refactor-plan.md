# Pre-Generation Flow Refactor

## Context

The current pre-generation questionnaire has 4 fixed questions (app_name, app_type, stage, team_size) followed by AI-personalized follow-ups. This is too long and the wrong UX: DrawToCloud should feel conversational, not like a form. Goal is to replace it with a streamlined single-screen form plus a structured chat-first discovery path for users who don't provide a description.

---

## New Flow

### With description (fast path)
`/new` form → name + description + 3 operational selectors (+ optional advanced) → "Generate Architecture" → canvas opens → pipeline starts immediately

### Without description (chat-first path)
`/new` form → name + 3 operational selectors (+ optional advanced) → "Start Designing" → canvas opens → AI asks structured discovery questions one at a time → AI presents architecture plan → user accepts → generation starts

---

## New Pre-Gen Form (`/new` screen)

Replace the entire `Questionnaire` component with a single-screen form:

```
[ Project name ]                         ← required text input

[ Describe your app ]                    ← optional textarea
  "Optional but recommended. The more detail you provide, the better the architecture."

  ▼ Use AI to analyze your codebase     ← collapsible AiPromptHelper section
    [ copyable prompt text block ]
    [ paste AI response here ]
    [ Apply ]

[ Region ]  [ Expected users ]  [ Uptime ]   ← 3 button-group selectors, always visible with defaults

▼ Advanced options                       ← collapsible section, collapsed by default
  [ Compliance ]  [ Environment ]  [ Compute preference ]

[ Generate Architecture ]  or  [ Start Designing ]
```

**Button label logic:**
- Description filled → "Generate Architecture" → starts pipeline immediately on canvas
- Description empty → "Start Designing" → enters canvas in chat-first discovery mode

---

## The AI Prompt Helper

Collapsible section below the description textarea. Lets users leverage their own Claude Code (or any AI with codebase access) to auto-describe their app.

**Prompt to copy:**
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

UI: copy button → paste-back textarea → "Apply" button fills the main description field.

---

## Operational Selectors

Always shown. Sensible defaults pre-selected. Rendered as button-group selectors (one active state per group).

| Field | Options | Default |
|---|---|---|
| Region | us-east-1, us-west-2, eu-west-1, ap-southeast-1, ap-northeast-1 | us-east-1 |
| Expected users | <1K/mo, 1K–100K/mo, 100K–1M/mo, 1M+/mo | 1K–100K/mo |
| Uptime | Best effort, 99.9% SLA, 99.99% SLA | 99.9% SLA |

---

## Advanced Options (collapsible)

Collapsed by default. Revealed by clicking "Advanced options". Each field is a button-group selector with a default so the user can leave it untouched.

| Field | Options | Default |
|---|---|---|
| Compliance | None, GDPR, HIPAA, PCI-DSS, SOC 2 | None |
| Environment | Development, Staging, Production | Production |
| Compute preference | No preference, Serverless (Lambda), Containers (ECS/EKS), VMs (EC2) | No preference |

**Behavior:**
- All three default to safe values — the user only opens this if they have specific constraints
- Advanced values are included in `answers` when present and passed to the Requirements Agent as hard constraints
- `compliance != "None"` triggers additional service restrictions in the Requirements Agent prompt (e.g. HIPAA requires PrivateLink, encrypted RDS, CloudTrail, no public S3)
- `environment == "Development"` suppresses multi-AZ and reduces instance tiers in the Coder Agent

---

## Chat-First Discovery Mode

Only activated when the user submits the `/new` form with an **empty description**. The AI conducts a structured interview, presents a written plan, and waits for explicit user acceptance before triggering generation.

### Step-by-step

1. `canvasSession.mode = "chat_first"`
2. `useCanvasPipeline` does **not** auto-start generation
3. Frontend sends: `{ type: "chat_discovery_start", app_name, region, expected_users, uptime, compliance?, environment?, compute_preference?, access_token }`
4. Backend creates project, subscribes WS
5. Backend sends an opening `chat_reply` — the first discovery question:
   *"Let's design your AWS infrastructure. First: what does your application do and who are the main users?"*
6. AI asks questions **one at a time**, waiting for each answer. Suggested question sequence:
   - What does the app do and who uses it?
   - What kind of data does it store and how sensitive is it?
   - Does it need real-time features, background jobs, or file storage?
   - What are your peak traffic expectations?
   - Any third-party integrations or external APIs?
7. After gathering sufficient context (typically 4–6 exchanges), AI responds with a structured **architecture plan** in chat:
   ```
   Here's the architecture I'd design for [app_name]:

   **Core services:** ECS Fargate, RDS PostgreSQL, ElastiCache Redis, ALB
   **Network:** VPC with public/private subnets, NAT Gateway, multi-AZ
   **Storage:** S3 for file uploads
   **Estimated cost:** ~$180/mo at your expected scale

   Ready to generate the Terraform? Click "Accept & Generate" to proceed,
   or tell me what you'd like to change.
   ```
8. An **"Accept & Generate"** button appears in the Chat panel below the plan message
9. Clicking it sends `start_generation` with a context summary built from the full conversation
10. Generation starts — same pipeline as the fast path from this point forward

### UI notes
- The "Accept & Generate" button only appears after the AI has presented a plan (backend signals this with a `plan_ready: true` flag on the `chat_reply` message)
- The user can keep chatting to revise the plan before accepting; the button persists and re-triggers with the latest context
- If the user types "generate" or "looks good" the AI should present the button prompt even if it hasn't been clicked

---

## New `answers` Data Shape

```typescript
{
  app_name: string,
  description?: string,           // free text or AI-assisted; absent in chat-first path
  region: string,                 // e.g. "us-east-1"
  expected_users: string,         // e.g. "1K–100K/mo"
  uptime: string,                 // e.g. "99.9% SLA"
  compliance?: string,            // e.g. "HIPAA" | "GDPR" | "PCI-DSS" | "SOC 2" | "None"
  environment?: string,           // e.g. "Production" | "Staging" | "Development"
  compute_preference?: string,    // e.g. "Containers (ECS/EKS)" | "Serverless (Lambda)" | "No preference"
}
```

Replaces old keys: `app_type`, `stage`, `team_size`, `q4`...`qN`

---

## New WebSocket Message Types

**Client → Server:**
```json
{ "type": "chat_discovery_start", "app_name": "...", "region": "...", "expected_users": "...", "uptime": "...", "compliance": "None", "environment": "Production", "compute_preference": "No preference", "access_token": "...", "project_id"?: "..." }
```

**Server → Client (in response):**
```json
{ "type": "project_ready", "project_id": "...", "share_slug": "..." }
{ "type": "chat_reply", "message": "Let's design your AWS infrastructure. First: what does your application do?", "plan_ready": false }
{ "type": "chat_reply", "message": "Here's the architecture I'd design...", "plan_ready": true }
```

The `plan_ready` flag on `chat_reply` tells the frontend to render the "Accept & Generate" button below that message.

---

## Files

### Delete
- `frontend/components/Questionnaire/` — entire folder (index.tsx, useQuestionnaire.ts, GenerateButton.tsx)

### Create
| File | Purpose |
|---|---|
| `frontend/components/PreGenForm/index.tsx` | Form UI (≤150 lines) |
| `frontend/components/PreGenForm/AiPromptHelper.tsx` | Copyable prompt + paste-back textarea |
| `frontend/components/PreGenForm/OperationalSelectors.tsx` | Region / Expected users / Uptime button-groups |
| `frontend/components/PreGenForm/AdvancedOptions.tsx` | Collapsible compliance / environment / compute selectors |
| `frontend/components/PreGenForm/usePreGenForm.ts` | Form state, validation, and submission logic |

### Modify
| File | Change |
|---|---|
| `frontend/app/new/page.tsx` | Replace `<Questionnaire>` with `<PreGenForm>`; pass `chat_first` mode flag to canvas |
| `frontend/lib/useCanvasPipeline.ts` | Add `chat_first` mode: skip auto-start; expose `triggerGeneration(conversationSummary)` |
| `frontend/components/Chat.tsx` | Render "Accept & Generate" button when `plan_ready` message received; button triggers `triggerGeneration()` |
| `backend/agents/requirements.py` | Accept new `answers` shape; apply `compliance`, `environment`, `compute_preference` as hard constraints in system prompt |
| `backend/ws_handler.py` | Handle `chat_discovery_start`; run discovery interview loop; emit `plan_ready: true` on `chat_reply` when plan is presented |
| `documents/data-reference.md` | Document new `answers` shape, `chat_discovery_start` WS message, and `plan_ready` flag |

---

## Backend Requirements Agent Changes

Update `generate_requirements(answers: dict)` system prompt to:
- Use `answers["description"]` as primary context when present (fast path)
- Use conversation summary as context when in chat-first path
- Apply `region`, `expected_users`, `uptime` as baseline infrastructure constraints
- Apply advanced options as hard constraints when present:
  - `compliance == "HIPAA"` → enforce PrivateLink, encrypted RDS, CloudTrail, no public S3, VPC endpoints
  - `compliance == "PCI-DSS"` → enforce WAF, dedicated VPC, no shared resources, audit logging
  - `compliance == "GDPR"` → enforce EU region, data residency isolation, right-to-erasure consideration in notes
  - `environment == "Development"` → suppress multi-AZ, use minimum instance tiers, no NAT Gateway
  - `compute_preference != "No preference"` → bias service selection toward chosen compute type

Output same JSON shape as before:

```json
{
  "app_name": "...",
  "inferred_services": [...],
  "architecture_style": "...",
  "notes": "..."
}
```

---

## Verification

1. **Fast path (with description)**: name + description + selectors → "Generate Architecture" → canvas builds diagram and Terraform immediately
2. **Chat-first path (no description)**: name + selectors → "Start Designing" → canvas opens → AI asks questions one at a time → AI presents plan → "Accept & Generate" appears → diagram builds
3. **AI prompt helper**: copy prompt → paste into Claude Code or any AI with codebase access → get structured response → paste back → Apply → description field fills → fast path flow works normally
4. **Advanced options**: set HIPAA compliance → verify Requirements Agent output includes PrivateLink, encrypted RDS, CloudTrail in generated Terraform
5. **Advanced options**: set Development environment → verify no multi-AZ resources in generated Terraform
6. **Requirements agent**: verify `description` + all selector values produce correct Terraform (resource names use `app_name`, multi-AZ if uptime is 99.99%, region-specific endpoints)
7. **Quota**: enforced before generation starts in both paths
8. **plan_ready flag**: verify "Accept & Generate" button appears only after AI presents plan message, not on earlier discovery messages
