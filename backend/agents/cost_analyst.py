import json
import asyncio
import logging
import subprocess
import tempfile
import os
import time
from pathlib import Path
from typing import Any

from llm_client import async_complete
from agents.log_helper import emit_log
from agents.utils import enrich_requirements

logger = logging.getLogger(__name__)

PRIMARY_HCL_TIMEOUT_SECONDS = 90
FALLBACK_ESTIMATE_TIMEOUT_SECONDS = 90

COST_HCL_SYSTEM = """
Generate a minimal Terraform main.tf for cost estimation only.
Include ONLY resources with direct costs: aws_instance, aws_db_instance,
aws_elasticache_cluster, aws_ecs_service+aws_ecs_task_definition,
aws_cloudfront_distribution, aws_lb, aws_nat_gateway, aws_s3_bucket.
Do NOT include: VPCs, subnets, security groups, IAM, ACM — these are free.
If `monthly_budget` or `budget_cap` is present in the input, treat it as a hard cap:
- Use the smallest viable instance types (t3.micro, db.t3.micro, 0.25vCPU Fargate)
- Do NOT include NAT Gateway, multi-AZ replicas, or premium add-ons unless explicitly required
- Minimize resource count to stay within budget
If no budget is provided, use realistic sizes: prototype=smallest (t3.micro, 0.25vCPU Fargate),
growth=medium, production=HA sizing.
Output valid HCL only. No prose.
"""

COST_ESTIMATE_SYSTEM = """
Estimate monthly AWS costs for the given architecture. Return JSON only:
{
  "monthly_total": number,
  "currency": "USD",
  "line_items": [{"service": "string", "resource_type": "string", "monthly_cost": number}],
  "generated_by": "claude_estimate",
  "note": "Estimated — connect Infracost for accurate pricing",
  "budget_cap": "number (optional, include when monthly_budget exists)",
  "over_budget": "boolean (optional, include when monthly_budget exists)",
  "overage_amount": "number (optional, include when monthly_budget exists)",
  "budget_actions": ["string"] (optional, include when monthly_budget exists),
  "budget_warning": "string (optional, include when estimate exceeds monthly_budget)"
}
No prose. Valid JSON only.
Input may include:
- monthly_budget: number (optional) — user's maximum monthly cost in USD (hard cap)
- budget_cap: number (optional) — same semantics as monthly_budget hard cap
Rule:
- If a budget exists, include the structured budget fields above.
- If the estimate exceeds budget, set over_budget=true, set overage_amount, include budget_warning, and suggest cheaper alternatives in budget_actions.
"""


async def run_cost_analyst(
    requirements: dict,
    websocket,
    start_time: float = 0,
    diagram_nodes: list | None = None,
    llm_creds: dict[str, Any] | None = None,
) -> None:
    started = time.monotonic()
    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None
    logger.info("cost_analyst.started trace_id=%s", trace_id)
    await emit_log(websocket, "cost_analyst", "Estimating costs...", start_time, trace_id=trace_id)
    await websocket.send_text(json.dumps({
        "type": "cost_status",
        "message": "Generating cost estimate...",
    }))

    enriched = enrich_requirements(requirements, diagram_nodes)

    try:
        # Step 1: Generate minimal HCL
        hcl_started = time.monotonic()
        raw_hcl = await asyncio.wait_for(
            async_complete(
                messages=[{"role": "user", "content": json.dumps(enriched, indent=2)}],
                system=COST_HCL_SYSTEM,
                llm_creds=llm_creds,
                log_context={"agent": "cost_analyst", "trace_id": trace_id},
            ),
            timeout=PRIMARY_HCL_TIMEOUT_SECONDS,
        )
        raw_hcl = raw_hcl.strip()
        if raw_hcl.startswith("```"):
            raw_hcl = raw_hcl.split("\n", 1)[1].rsplit("```", 1)[0]
        logger.info(
            "cost_analyst.hcl_generated trace_id=%s duration_ms=%d chars=%d",
            trace_id,
            int((time.monotonic() - hcl_started) * 1000),
            len(raw_hcl),
        )

        # Step 2: Write to temp dir and run infracost
        await emit_log(websocket, "cost_analyst", "Calling Infracost API", start_time, trace_id=trace_id)
        with tempfile.TemporaryDirectory() as tmpdir:
            tf_path = Path(tmpdir) / "main.tf"
            tf_path.write_text(raw_hcl)

            subprocess_started = time.monotonic()
            result = await asyncio.to_thread(
                subprocess.run,
                ["infracost", "breakdown", "--path", str(tmpdir),
                 "--format", "json", "--no-cache"],
                capture_output=True,
                text=True,
                timeout=120,
                env={**os.environ},
            )
            logger.info(
                "cost_analyst.infracost_completed trace_id=%s duration_ms=%d return_code=%s",
                trace_id,
                int((time.monotonic() - subprocess_started) * 1000),
                result.returncode,
            )

            if result.returncode != 0:
                logger.warning(
                    "cost_analyst.infracost_failed trace_id=%s return_code=%s",
                    trace_id,
                    result.returncode,
                )
                raise RuntimeError(f"infracost failed: {result.stderr[:200]}")

            cost_data = json.loads(result.stdout)
            breakdown = _apply_budget_warning(_parse_infracost_output(cost_data), enriched)

        await websocket.send_text(json.dumps({
            "type": "cost_estimate",
            "data": breakdown,
        }))
        logger.info(
            "cost_analyst.completed trace_id=%s duration_ms=%d monthly_total=%s",
            trace_id,
            int((time.monotonic() - started) * 1000),
            breakdown.get("monthly_total") if isinstance(breakdown, dict) else None,
        )
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time, trace_id=trace_id)

    except asyncio.TimeoutError:
        logger.warning(
            "Cost analyst primary LLM call timed out, using AI estimate fallback trace_id=%s",
            trace_id,
            exc_info=True,
        )
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "cost_analyst",
            "event": "llm_timeout_fallback",
            "level": "warning",
            "message": "Cost analyst timed out while generating HCL; using AI estimate fallback.",
        }))
        await _send_estimated_costs(enriched, websocket, start_time, llm_creds=llm_creds, trace_id=trace_id)
    except Exception:
        logger.warning("Infracost failed, using AI estimate fallback trace_id=%s", trace_id, exc_info=True)
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "cost_analyst",
            "event": "infracost_fallback",
            "level": "warning",
            "message": "Infracost failed, using AI estimate fallback.",
        }))
        await _send_estimated_costs(enriched, websocket, start_time, llm_creds=llm_creds, trace_id=trace_id)


def _parse_infracost_output(data: dict) -> dict:
    projects = data.get("projects", [])
    if not projects:
        return {"monthly_total": 0, "currency": "USD", "line_items": [], "generated_by": "infracost"}

    resources = projects[0].get("breakdown", {}).get("resources", [])
    line_items = []
    for resource in resources:
        monthly = float(resource.get("monthlyCost") or 0)
        if monthly == 0:
            continue
        line_items.append({
            "service": resource.get("name", "Unknown"),
            "resource_type": resource.get("resourceType", ""),
            "monthly_cost": round(monthly, 2),
        })

    total = sum(item["monthly_cost"] for item in line_items)
    return {
        "monthly_total": round(total, 2),
        "currency": "USD",
        "line_items": sorted(line_items, key=lambda x: x["monthly_cost"], reverse=True),
        "generated_by": "infracost",
    }


async def _send_estimated_costs(
    requirements: dict,
    websocket,
    start_time: float = 0,
    llm_creds: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> None:
    fallback_started = time.monotonic()
    await emit_log(websocket, "cost_analyst", "Using AI cost estimation", start_time, trace_id=trace_id)
    prompt = "Estimate monthly AWS costs for this architecture:\n" + json.dumps(requirements)
    try:
        raw = await asyncio.wait_for(
            async_complete(
                messages=[{"role": "user", "content": prompt}],
                system=COST_ESTIMATE_SYSTEM,
                llm_creds=llm_creds,
                log_context={"agent": "cost_analyst", "trace_id": trace_id},
            ),
            timeout=FALLBACK_ESTIMATE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "cost_analyst.fallback_timeout trace_id=%s duration_ms=%d",
            trace_id,
            int((time.monotonic() - fallback_started) * 1000),
        )
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "cost_analyst",
            "event": "fallback_timeout",
            "level": "warning",
            "message": "AI fallback cost estimate timed out.",
        }))
        await websocket.send_text(json.dumps({
            "type": "cost_estimate",
            "data": {
                "monthly_total": 0,
                "currency": "USD",
                "line_items": [],
                "generated_by": "estimation_failed",
                "note": "Cost estimation unavailable. Please try again.",
            }
        }))
        return

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        data = _apply_budget_warning(json.loads(raw), requirements)
        await websocket.send_text(json.dumps({"type": "cost_estimate", "data": data}))
        logger.info(
            "cost_analyst.fallback_completed trace_id=%s duration_ms=%d monthly_total=%s",
            trace_id,
            int((time.monotonic() - fallback_started) * 1000),
            data.get("monthly_total") if isinstance(data, dict) else None,
        )
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time, trace_id=trace_id)
    except Exception:
        logger.warning("cost_analyst.fallback_parse_failed trace_id=%s", trace_id, exc_info=True)
        await websocket.send_text(json.dumps({
            "type": "cost_estimate",
            "data": {
                "monthly_total": 0,
                "currency": "USD",
                "line_items": [],
                "generated_by": "estimation_failed",
                "note": "Cost estimation unavailable. Please try again.",
            }
        }))


def _apply_budget_warning(cost_data: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any]:
    monthly_budget = requirements.get("budget_cap")
    if not isinstance(monthly_budget, (int, float)) or isinstance(monthly_budget, bool):
        monthly_budget = requirements.get("monthly_budget")

    if not isinstance(monthly_budget, (int, float)) or isinstance(monthly_budget, bool):
        return cost_data
    monthly_budget = round(float(monthly_budget), 2)
    if monthly_budget < 5:
        return cost_data

    monthly_total = cost_data.get("monthly_total")
    if not isinstance(monthly_total, (int, float)) or isinstance(monthly_total, bool):
        return {
            **cost_data,
            "budget_cap": monthly_budget,
            "over_budget": False,
            "overage_amount": 0.0,
            "budget_actions": ["Unable to validate budget overage because monthly_total is missing or invalid."],
        }

    overage = round(max(float(monthly_total) - monthly_budget, 0), 2)
    over_budget = overage > 0
    budget_actions = []
    if over_budget:
        budget_actions = [
            "Default to a single region and single AZ unless compliance or SLA requires otherwise.",
            "Right-size compute, database, and cache to the smallest viable tiers.",
            "Avoid costly defaults like NAT Gateway, multi-AZ replicas, and premium managed add-ons unless required.",
            "Reduce redundancy and throughput headroom where constraints allow.",
        ]

    enriched = {
        **cost_data,
        "budget_cap": monthly_budget,
        "over_budget": over_budget,
        "overage_amount": overage,
        "budget_actions": budget_actions,
    }

    if not over_budget:
        enriched.pop("budget_warning", None)
        return enriched

    warning = (
        f"Estimated monthly cost exceeds your ${monthly_budget:.2f} budget by ${overage:.2f}. "
        "Consider smaller instance classes, reduced HA/region footprint, or replacing managed services with lighter tiers."
    )
    return {**enriched, "budget_warning": warning}
