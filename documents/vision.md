# DrawToCloud — Vision & Roadmap

## North Star

**DrawToCloud is the Figma for cloud infrastructure.**

Just as Figma made UI design collaborative, visual, and accessible without removing depth for experts — DrawToCloud makes AWS architecture design visual, shareable, and AI-augmented without dumbing it down.

The end state: teams design infrastructure the way they design products. They sketch it in DrawToCloud, iterate on it together, export it to Terraform, and version it alongside their code.

---

## What That Means in Practice (3-Year Picture)

- An architect opens DrawToCloud, describes what they're building in a sentence, and a real architecture appears on the canvas in real time — not a template, a tailored design.
- They can drag components, add services, remove bottlenecks. Every change regenerates compliant Terraform instantly.
- They share a link. A teammate opens it, comments on the RDS setup, suggests a read replica. The architect applies it with one click.
- A PM opens the same link and sees the cost estimate. They don't understand Terraform — but they understand "$180/month, scaling to $340 at 100k users."
- The team commits the diagram and the Terraform to their repo. When infrastructure drifts from the diagram, they get an alert.

---

## Roadmap

### NOW — MVP (shipped)
*Proving the core loop: describe → diagram → export*

- [x] Smart onboarding questionnaire (AI-personalized follow-up questions)
- [x] WebSocket streaming scaffold (diagram events consumed live)
- [x] Real agent pipeline: Requirements → Architect → (Coder + Cost Analyst + Description) in parallel
- [x] Terraform export panel with download
- [x] Cost estimate panel
- [x] Manual canvas editing: add, remove, rename nodes — triggers full Terraform regeneration
- [x] Supabase Auth (email/password + OAuth)
- [x] Generation history dashboard
- [x] Quota system with admin entitlements
- [x] /health/ready endpoint with DB probe
- [ ] Shareable diagram link via Supabase anonymous storage

This sprint also fixed critical foundation bugs: atomic quota increment, asyncio correctness for all Supabase/infracost calls, architect parse-failure counting, CORS from env var, and agent cancellation via TaskGroup.

**Success metric:** A solo founder can describe their SaaS app and download working Terraform in under 2 minutes.

---

### NEXT — V1: Quality & Trust
*Making the output good enough for real projects*

- Terraform validation (tfsec + `terraform validate`) — Validator agent
- Architect agent produces best-practice architectures (multi-AZ, proper IAM, security groups)
- Cost estimate accuracy improvement (Infracost integration)
- Diagram polish: edge labels, node icons per service type, auto-layout options
- "Explain this architecture" mode — plain-English walkthrough of every component
- Architecture templates library (web app, data pipeline, AI workload, e-commerce)
- Canvas history / undo stack

**Success metric:** ICP 2 (DevOps engineer) can commit the exported Terraform to their repo with minor edits only.

---

### LATER — V2: Collaboration & Accounts
*Enabling teams to design infrastructure together*

- User accounts (email/OAuth)
- Team workspaces — shared diagram library, access control
- Real-time multiplayer on canvas (Figma-style cursors)
- Comments and suggestions on diagram nodes
- Light mode
- Version history for diagrams
- "Compare architectures" — diff two diagram versions

**Success metric:** A startup CTO and their platform engineer are both in the same diagram simultaneously, iterating.

---

### FUTURE — V3: Live Infrastructure
*Closing the loop between design and reality*

- AWS account connection (read-only first: import existing infra as a diagram)
- Deploy button — provisions infrastructure directly from the diagram
- Drift detection — alerts when real AWS state diverges from the diagram
- Cost monitoring — actual spend vs. estimate, per service
- Commission model — DrawToCloud earns a % on AWS spend routed through the platform

**This is the moat.** If the diagram is the source of truth for both design *and* deployed infrastructure, switching cost becomes enormous.

---

## Guiding Principles

1. **Speed is the feature.** From description to diagram should feel instant. From diagram to Terraform should be one click.

2. **Output quality earns trust.** ICP 2 will scrutinize generated Terraform. If it's wrong once, they leave. The Architect and Coder agents must produce correct, idiomatic, production-safe output.

3. **Never obscure the complexity.** Unlike Heroku or Railway, we don't hide AWS from the user — we help them understand it. Explanations are a first-class feature.

4. **Managed LLM keys simplify onboarding.** LLM keys are currently server-side (operator-managed). BYOK (user-supplied keys) remains a future option for a privacy-first or self-hosted tier.

5. **Canvas is the source of truth.** All exports — Terraform, cost estimates, diagrams, shareable links — derive from the canvas state. The canvas is not a read-only view; it is the primary editing surface.

---

## What We Are Not Building (Intentionally)

- A Terraform IDE or linter (that's HashiCorp's job)
- A cloud cost monitoring tool (that's Datadog / CloudHealth)
- A managed infrastructure platform (that's Pulumi / Terraform Cloud)
- A diagramming tool without AI (that's Lucidchart / draw.io)

We are the AI-powered design layer that sits *between* "idea" and "infrastructure." Everything else is out of scope until we own that layer.
