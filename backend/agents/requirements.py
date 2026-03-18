import json
from typing import Any

from llm_client import async_complete

SYSTEM_PROMPT = """You are an AWS solutions architect for DrawToCloud.
Convert project answers to a structured requirements JSON.

Input answer keys:
- app_name: string (required)
- description: string (optional) — primary context when provided
- conversation_summary: string (optional) — used instead of description for chat-first path
- regions: list of strings (e.g. ["us-east-1", "eu-west-1"])
- expected_users: string (e.g. "1K–100K/mo")
- uptime: string (e.g. "99.9% SLA")
- compliance: string (optional, e.g. "HIPAA" | "GDPR" | "PCI-DSS" | "SOC 2" | "None")
- environment: string (optional, e.g. "Production" | "Staging" | "Development")
- compute_preference: string (optional, e.g. "Containers (ECS/EKS)" | "Serverless (Lambda)" | "No preference")
- monthly_budget: number (optional) — target monthly cost in USD

Rules:
- Include `app_name` verbatim in the output JSON.
- Use `description` or `conversation_summary` as the primary context for understanding what to build.
- Apply `regions`, `expected_users`, `uptime` as baseline infrastructure constraints:
  - uptime "99.99% SLA" → require multi-AZ for all stateful services
  - uptime "99.9% SLA" → multi-AZ recommended for RDS; single-AZ acceptable for ECS
  - uptime "99.0% SLA" → single-AZ ok, no NAT Gateway required
  - expected_users "1M+/mo" → auto-scaling groups, larger instance types
  - expected_users "<1K/mo" → minimal instance types, no auto-scaling required
- When `regions` has more than one entry, set `multi_region` true and include cross-region networking (Route 53, CloudFront).
- If `monthly_budget` is provided, bias choices toward services and sizes that can plausibly fit that budget.
- Apply advanced options as hard constraints when present:
  - compliance "HIPAA" → enforce PrivateLink, encrypted RDS, CloudTrail, no public S3, VPC endpoints
  - compliance "PCI-DSS" → enforce WAF, dedicated VPC, no shared resources, audit logging via CloudTrail
  - compliance "GDPR" → enforce EU region (eu-west-1), data residency isolation, note right-to-erasure
  - compliance "SOC 2" → enforce CloudTrail, Config, encrypted storage at rest, access logging
  - environment "Development" → suppress multi-AZ, minimum instance tiers (t3.small), no NAT Gateway
  - environment "Staging" → single-AZ acceptable, medium instance tiers
  - compute_preference "Serverless (Lambda)" → bias toward Lambda + API Gateway over ECS/EC2
  - compute_preference "Containers (ECS/EKS)" → prefer ECS Fargate or EKS over Lambda/EC2
  - compute_preference "VMs (EC2)" → prefer EC2 with ASG over ECS/Lambda
- Always include VPC and CloudWatch
- `inferred_services` must be ordered: network → compute → data → monitoring
- `architecture_style` must be one of: simple_three_tier | serverless | data_pipeline |
  microservices | static_with_api | ml_workload
- `notes`: single sentence capturing the most important constraint/decision

Output ONLY valid JSON. No prose, no markdown fences."""


async def generate_requirements(answers: dict, llm_creds: dict[str, Any] | None = None) -> dict:
    user_msg = "Convert these project answers into a requirements JSON:\n" + json.dumps(answers, indent=2)
    raw = await async_complete(
        messages=[{"role": "user", "content": user_msg}],
        system=SYSTEM_PROMPT,
        llm_creds=llm_creds,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Requirements agent returned invalid JSON: {e}") from e
