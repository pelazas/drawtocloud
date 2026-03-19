export const FF = '"DM Sans", system-ui, sans-serif';
export const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

export const CATEGORY_COLORS: Record<string, string> = {
  network: "#3b82f6",
  compute: "#f97316",
  database: "#22c55e",
  storage: "#eab308",
  security: "#ef4444",
  monitoring: "#a855f7",
};

export const AI_PROMPT_PREVIEW = `You are helping me generate AWS infrastructure using DrawToCloud.\n\nAnalyze my codebase and respond in EXACTLY this structured format. No markdown, no preamble...`;

export const AI_RESPONSE = `WHAT IT DOES
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
- Requires secure secret management for SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, and CLOUDFLARE credentials.`;

export const AI_FULL_PROMPT = `You are helping me generate AWS infrastructure using DrawToCloud.

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

This output feeds directly into an AI system that generates Terraform infrastructure. Vague or incomplete answers produce generic, unusable results. Be precise.`;

export const TERRAFORM_LINES = [
  'resource "aws_vpc" "main" {',
  '  cidr_block           = "10.0.0.0/16"',
  '  enable_dns_hostnames = true',
  '  tags = { Name = "wikiglobe-vpc" }',
  '}',
  '',
  'resource "aws_ecs_cluster" "app" {',
  '  name = "wikiglobe-cluster"',
  '  setting {',
  '    name  = "containerInsights"',
  '    value = "enabled"',
  '  }',
  '}',
  '',
  'resource "aws_db_instance" "postgres" {',
  '  engine            = "postgres"',
  '  engine_version    = "15.4"',
  '  instance_class    = "db.t3.medium"',
  '  allocated_storage = 20',
  '}',
];

export const COST_ROWS = [
  ["ECS Fargate (2 tasks x 0.25 vCPU)", "$18.40"],
  ["RDS PostgreSQL (db.t3.medium)", "$15.20"],
  ["Application Load Balancer", "$6.80"],
  ["ElastiCache (cache.t3.micro)", "$4.10"],
  ["S3 + data transfer", "$1.60"],
  ["CloudWatch logs", "$0.90"],
] as const;
