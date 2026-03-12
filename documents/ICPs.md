# DrawToCloud — Ideal Customer Profiles

Two confirmed ICPs based on product direction. Treat these as dossiers — build features for them, write copy for them, price for them.

---

## ICP 1 — The Resourceful Builder

> *"I need to ship infra this week. I don't have time to become an AWS expert."*

### Who they are
Solo founders, indie hackers, and small-team technical co-founders. They're building something real but don't have a dedicated DevOps or platform engineer. They know enough AWS to be dangerous — they've set up an EC2 or S3 bucket before — but production-grade architecture (VPCs, IAM, load balancers, autoscaling) feels like a black box.

They're cost-conscious, time-poor, and allergic to complexity they can't explain.

### Demographics
- 1–5 person team, often just them
- Building: SaaS, internal tools, mobile backends, AI-powered apps
- Stage: Prototype → MVP → early Growth
- AWS experience: beginner to intermediate
- Budget: personal credit card or seed money; wants to know what things cost *before* they build
- Uses: Vercel, Railway, Supabase, Fly.io — productized infrastructure they can reason about

### What they need
- **Speed over perfection.** Get to a working architecture in minutes, not days.
- **Plain-language explanations.** "Why is there a NAT gateway? Can I skip it for now?"
- **Cost visibility upfront.** "$142/month" before committing beats a surprise AWS bill.
- **Terraform output they can actually use.** Copy-paste into a repo, run `terraform apply`, done.
- **Something they can show to early investors or co-founders** — a real diagram, not a napkin sketch.

### What they want to do
- Describe their app in plain English → get a sensible AWS diagram immediately
- Understand what each component does without reading AWS docs
- Export Terraform and deploy themselves (or hand it to a contractor)
- Save and share the diagram with a link

### What they can do
- Write and run Terraform with guidance
- Make decisions about trade-offs if explained simply (e.g., ECS vs. Lambda)
- Pay $20–$50/month for a tool that saves them a week of research
- Become a vocal advocate if the product "just works"

### Fears
- Overbuilding and paying for infrastructure they don't need
- Getting locked into a bad architecture they'll regret at scale
- AWS bills spiraling out of control
- Looking uninformed in front of investors or technical advisors

### Where to find them
- Twitter/X (build-in-public crowd)
- Indie Hackers, Hacker News (Show HN)
- Product Hunt launches
- r/SaaS, r/startups
- Discord communities (YC, Buildspace, Lenny's)

### What success looks like for them
They describe their SaaS app, get a diagram in 30 seconds, understand it, export the Terraform, and deploy to AWS in under an hour. They tell their Twitter followers about it.

---

## ICP 2 — The Infrastructure Pragmatist

> *"I know exactly what I want. I just hate writing boilerplate Terraform for the tenth time."*

### Who they are
DevOps engineers, platform engineers, SREs, and senior backend engineers who live in AWS. They design architectures regularly, but the tedious parts — wiring up VPCs, writing IAM policies, generating module boilerplate — consume hours they'd rather spend on interesting problems.

They're opinionated, technical, and impatient with tools that dumb things down too much.

### Demographics
- 5–50 person engineering team
- Role: DevOps / Platform / SRE / Senior Backend
- Stage: Growth → Production
- AWS experience: intermediate to expert (AWS certifications common)
- Budget: company card; can expense tools under $100/month without approval
- Uses: Terraform, Pulumi, AWS CDK, Atlantis, Terragrunt

### What they need
- **Fast prototyping.** Sketch an architecture visually, then export clean Terraform they can actually commit.
- **Correct output.** The Terraform must follow best practices — proper module structure, variables, outputs, no hardcoded values.
- **Flexibility.** They want to tweak the diagram and regenerate, not babysit a form.
- **Something to show non-technical stakeholders.** A clean diagram beats a wall of `.tf` files in a PR review.

### What they want to do
- Start from a description or an existing architecture pattern
- Tweak nodes on the canvas (add Redis, remove NAT gateway, rename the ECS cluster)
- Regenerate Terraform instantly after each canvas edit
- Export and commit to their infra repo

### What they can do
- Evaluate Terraform output critically and modify it
- Integrate the tool into their existing workflow (Git, CI/CD)
- Pay for a seat license or team plan if the output quality justifies it
- Become internal champions who roll it out to their whole team

### Fears
- Generated Terraform that's wrong, insecure, or unidiomatic — embarrassing to commit
- A tool that treats them like a beginner
- Vendor lock-in or proprietary state formats
- Security issues (their API key handled carelessly)

### Where to find them
- DevOps-focused Slack communities (Hangops, DevOps Chat)
- r/devops, r/aws, r/Terraform
- HashiCorp forums and community
- AWS re:Invent / re:Inforce
- LinkedIn (DevOps / Platform Engineer job title)
- GitHub — they're searching for Terraform modules

### What success looks like for them
They sketch a multi-AZ ECS architecture, drag in an RDS Multi-AZ instance, and export production-ready Terraform in 5 minutes. The output is clean enough to commit with minor edits. They show it to their CTO in a Slack thread.

---

## Notes for Product Decisions

- **Feature tension:** ICP 1 wants simplicity and explanations; ICP 2 wants power and correctness. When these conflict, ship for ICP 2 first — ICP 1 will grow into it; ICP 2 will leave if the output is bad.
- **Pricing signal:** ICP 1 is price-sensitive; ICP 2 has budget. A free tier (limited exports/month) captures ICP 1; a paid plan ($29–$79/month per seat) converts ICP 2.
- **Trust signal:** Both ICPs care deeply that API keys are handled safely. The "Bring your own key. We never store it." messaging is non-negotiable for both.
- **Quality bar:** ICP 2 will scrutinize generated Terraform. Incorrect or insecure output will kill word-of-mouth in their community immediately.
