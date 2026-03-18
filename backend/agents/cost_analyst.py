import json
import asyncio
import logging
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Any

from llm_client import async_complete
from agents.log_helper import emit_log
from agents.utils import enrich_requirements

logger = logging.getLogger(__name__)

COST_HCL_SYSTEM = """
Generate a minimal Terraform main.tf for cost estimation only.
Include ONLY resources with direct costs: aws_instance, aws_db_instance,
aws_elasticache_cluster, aws_ecs_service+aws_ecs_task_definition,
aws_cloudfront_distribution, aws_lb, aws_nat_gateway, aws_s3_bucket.
Do NOT include: VPCs, subnets, security groups, IAM, ACM — these are free.
Use realistic sizes: prototype=smallest (t3.micro, 0.25vCPU Fargate),
growth=medium, production=HA sizing. Output valid HCL only. No prose.
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
    await emit_log(websocket, "cost_analyst", "Estimating costs...", start_time)
    await websocket.send_text(json.dumps({
        "type": "cost_status",
        "message": "Generating cost estimate...",
    }))

    enriched = enrich_requirements(requirements, diagram_nodes)

    # Step 1: Generate minimal HCL
    raw_hcl = await async_complete(
        messages=[{"role": "user", "content": json.dumps(enriched, indent=2)}],
        system=COST_HCL_SYSTEM,
        llm_creds=llm_creds,
    )
    raw_hcl = raw_hcl.strip()
    if raw_hcl.startswith("```"):
        raw_hcl = raw_hcl.split("\n", 1)[1].rsplit("```", 1)[0]

    # Step 2: Write to temp dir and run infracost
    try:
        await emit_log(websocket, "cost_analyst", "Calling Infracost API", start_time)
        with tempfile.TemporaryDirectory() as tmpdir:
            tf_path = Path(tmpdir) / "main.tf"
            tf_path.write_text(raw_hcl)

            result = await asyncio.to_thread(
                subprocess.run,
                ["infracost", "breakdown", "--path", str(tmpdir),
                 "--format", "json", "--no-cache"],
                capture_output=True,
                text=True,
                timeout=120,
                env={**os.environ},
            )

            if result.returncode != 0:
                raise RuntimeError(f"infracost failed: {result.stderr[:200]}")

            cost_data = json.loads(result.stdout)
            breakdown = _apply_budget_warning(_parse_infracost_output(cost_data), enriched)

        await websocket.send_text(json.dumps({
            "type": "cost_estimate",
            "data": breakdown,
        }))
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time)

    except Exception:
        logger.warning("Infracost failed, using AI estimate fallback", exc_info=True)
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "cost_analyst",
            "event": "infracost_fallback",
            "level": "warning",
            "message": "Infracost failed, using AI estimate fallback.",
        }))
        await _send_estimated_costs(enriched, websocket, start_time, llm_creds=llm_creds)


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
) -> None:
    await emit_log(websocket, "cost_analyst", "Using AI cost estimation", start_time)
    prompt = "Estimate monthly AWS costs for this architecture:\n" + json.dumps(requirements)
    raw = await async_complete(
        messages=[{"role": "user", "content": prompt}],
        system=COST_ESTIMATE_SYSTEM,
        llm_creds=llm_creds,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        data = _apply_budget_warning(json.loads(raw), requirements)
        await websocket.send_text(json.dumps({"type": "cost_estimate", "data": data}))
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time)
    except Exception:
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
