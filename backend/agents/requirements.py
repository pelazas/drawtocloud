import json
import logging
import time
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
- monthly_budget: number (optional) — maximum monthly cost in USD (hard cap)

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
- If `monthly_budget` is provided, treat it as a hard cap (not a soft target):
  - choose the lowest-cost viable architecture first
  - default to single region + single AZ, smallest viable tiers, and no premium add-ons unless explicitly required
  - if required constraints (compliance/uptime/scale) force higher cost, keep the requirement but state that conflict in `notes`
  - pass budget semantics forward by including `monthly_budget`, `budget_cap` (same value), and `budget_is_hard_cap` = true
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

logger = logging.getLogger(__name__)


def _normalize_budget(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    budget = float(value)
    if budget < 5:
        return None
    return round(budget, 2)


def _apply_budget_semantics(requirements: Any, answers: dict[str, Any]) -> Any:
    if not isinstance(requirements, dict):
        return requirements

    budget = _normalize_budget(answers.get("monthly_budget"))
    if budget is None:
        return requirements

    enriched = dict(requirements)
    enriched["monthly_budget"] = budget
    enriched["budget_cap"] = budget
    enriched["budget_is_hard_cap"] = True

    note_suffix = (
        f"Monthly budget hard cap is ${budget:.2f}; prioritize least-cost architecture that meets required constraints."
    )
    notes = enriched.get("notes")
    if isinstance(notes, str) and notes.strip():
        lower_notes = notes.lower()
        if "hard cap" not in lower_notes and "monthly budget" not in lower_notes:
            enriched["notes"] = f"{notes.rstrip('.')} {note_suffix}"
    else:
        enriched["notes"] = note_suffix

    return enriched


async def generate_requirements(
    answers: dict,
    llm_creds: dict[str, Any] | None = None,
    *,
    trace_id: str | None = None,
) -> dict:
    started = time.monotonic()
    logger.info("requirements.started trace_id=%s", trace_id)
    user_msg = "Convert these project answers into a requirements JSON:\n" + json.dumps(answers, indent=2)
    raw = await async_complete(
        messages=[{"role": "user", "content": user_msg}],
        system=SYSTEM_PROMPT,
        llm_creds=llm_creds,
        log_context={"agent": "requirements", "trace_id": trace_id},
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning(
            "requirements.parse_failed trace_id=%s duration_ms=%d error=%s",
            trace_id,
            int((time.monotonic() - started) * 1000),
            str(e),
        )
        raise ValueError(f"Requirements agent returned invalid JSON: {e}") from e
    inferred_services = parsed.get("inferred_services") if isinstance(parsed, dict) else None
    service_count = len(inferred_services) if isinstance(inferred_services, list) else None
    app_name = parsed.get("app_name") if isinstance(parsed, dict) else None
    logger.info(
        "requirements.completed trace_id=%s duration_ms=%d app_name=%s service_count=%s",
        trace_id,
        int((time.monotonic() - started) * 1000),
        app_name,
        service_count,
    )
    return _apply_budget_semantics(parsed, answers)
