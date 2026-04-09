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

REPAIR_SYSTEM_PROMPT = """You repair malformed DrawToCloud requirements payloads.

Given the original questionnaire answers and a previous invalid model response, output a corrected requirements JSON.

Requirements:
- Output ONLY valid JSON.
- Top-level value must be an object.
- Required fields:
  - `app_name`: non-empty string
  - `architecture_style`: one of simple_three_tier | serverless | data_pipeline | microservices | static_with_api | ml_workload
  - `inferred_services`: non-empty array of strings ordered network -> compute -> data -> monitoring
  - `notes`: non-empty string
- Preserve valid information from the prior response when possible.
- If the prior response is unusable, reconstruct the minimal valid payload from the questionnaire answers.
"""

logger = logging.getLogger(__name__)
_VALID_ARCHITECTURE_STYLES = {
    "simple_three_tier",
    "serverless",
    "data_pipeline",
    "microservices",
    "static_with_api",
    "ml_workload",
}


def _strip_markdown_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
    return text.strip()


def _parse_json_payload(raw: str) -> tuple[Any, bool]:
    """Parse JSON from model output, recovering from leading/trailing prose when possible."""
    text = _strip_markdown_fences(raw)
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    object_starts = [index for index, char in enumerate(text) if char == "{"]
    for start in object_starts:
        try:
            parsed, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        has_extra_content = bool(text[start + end :].strip()) or start > 0
        return parsed, has_extra_content

    candidate_starts = [index for index, char in enumerate(text) if char in "{["]
    for start in candidate_starts:
        try:
            parsed, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        has_extra_content = bool(text[start + end :].strip()) or start > 0
        return parsed, has_extra_content

    # Raise with the original parser semantics for clear error messaging.
    return json.loads(text), False


def _normalize_budget(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    budget = float(value)
    if budget < 5:
        return None
    return round(budget, 2)


def _fallback_app_name(answers: dict[str, Any]) -> str:
    for key in ("app_name", "project_name", "name"):
        value = answers.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Untitled Project"


def _enrich_requirements_payload(payload: Any, answers: dict[str, Any]) -> Any:
    if not isinstance(payload, dict):
        return payload

    enriched = dict(payload)
    app_name = enriched.get("app_name")
    if not isinstance(app_name, str) or not app_name.strip():
        enriched["app_name"] = _fallback_app_name(answers)
    return enriched


def _validate_requirements_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Requirements agent returned invalid JSON: top-level JSON must be an object")

    missing: list[str] = []
    app_name = payload.get("app_name")
    if not isinstance(app_name, str) or not app_name.strip():
        missing.append("app_name")

    architecture_style = payload.get("architecture_style")
    if architecture_style not in _VALID_ARCHITECTURE_STYLES:
        missing.append("architecture_style")

    inferred_services = payload.get("inferred_services")
    if not isinstance(inferred_services, list) or not any(
        isinstance(service, str) and service.strip() for service in inferred_services
    ):
        missing.append("inferred_services")

    notes = payload.get("notes")
    if not isinstance(notes, str) or not notes.strip():
        missing.append("notes")

    if missing:
        raise ValueError(
            "Requirements agent returned invalid JSON: missing required fields "
            + ", ".join(missing)
        )

    return payload


async def _repair_requirements_output(
    answers: dict[str, Any],
    invalid_output: str,
    llm_creds: dict[str, Any] | None,
    trace_id: str | None,
) -> str:
    repair_message = (
        "Repair this requirements output into valid DrawToCloud JSON.\n\n"
        f"Questionnaire answers:\n{json.dumps(answers, indent=2)}\n\n"
        f"Previous invalid output:\n{invalid_output}"
    )
    return await async_complete(
        messages=[{"role": "user", "content": repair_message}],
        system=REPAIR_SYSTEM_PROMPT,
        llm_creds=llm_creds,
        log_context={"agent": "requirements_repair", "trace_id": trace_id},
    )


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
    enriched["budget_enforcement_mode"] = "strict"
    enriched["budget_optimization_instruction"] = (
        f"HARD CAP: keep estimated monthly total <= ${budget:.2f}. "
        "Choose the absolute cheapest viable architecture: single AZ, smallest instance tiers, "
        "no NAT Gateway, no multi-AZ replicas, no premium add-ons unless explicitly required by compliance or uptime constraints."
    )

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

    recovered = False
    for attempt in range(2):
        try:
            parsed, recovered = _parse_json_payload(raw)
            parsed = _enrich_requirements_payload(parsed, answers)
            validated = _validate_requirements_payload(parsed)
            break
        except json.JSONDecodeError as e:
            logger.warning(
                "requirements.parse_failed trace_id=%s duration_ms=%d attempt=%d error=%s",
                trace_id,
                int((time.monotonic() - started) * 1000),
                attempt + 1,
                str(e),
            )
            if attempt == 1:
                raise ValueError(f"Requirements agent returned invalid JSON: {e}") from e
            raw = await _repair_requirements_output(answers, raw, llm_creds, trace_id)
        except ValueError as e:
            logger.warning(
                "requirements.validation_failed trace_id=%s duration_ms=%d attempt=%d error=%s",
                trace_id,
                int((time.monotonic() - started) * 1000),
                attempt + 1,
                str(e),
            )
            if attempt == 1:
                raise
            raw = await _repair_requirements_output(answers, raw, llm_creds, trace_id)

    if recovered:
        logger.info(
            "requirements.parse_recovered trace_id=%s duration_ms=%d",
            trace_id,
            int((time.monotonic() - started) * 1000),
        )

    inferred_services = validated.get("inferred_services") if isinstance(validated, dict) else None
    service_count = len(inferred_services) if isinstance(inferred_services, list) else None
    app_name = validated.get("app_name") if isinstance(validated, dict) else None
    logger.info(
        "requirements.completed trace_id=%s duration_ms=%d app_name=%s service_count=%s",
        trace_id,
        int((time.monotonic() - started) * 1000),
        app_name,
        service_count,
    )
    return _apply_budget_semantics(validated, answers)
