import json
import asyncio
import subprocess
import tempfile
import os
from pathlib import Path
from llm_client import async_complete
from agents.log_helper import emit_log

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
  "note": "Estimated — connect Infracost for accurate pricing"
}
No prose. Valid JSON only.
"""

async def run_cost_analyst(requirements: dict, websocket, start_time: float = 0) -> None:
    await emit_log(websocket, "cost_analyst", "Estimating costs...", start_time)
    await websocket.send_text(json.dumps({
        "type": "cost_status",
        "message": "Generating cost estimate...",
    }))

    # Step 1: Generate minimal HCL
    raw_hcl = await async_complete(
        messages=[{"role": "user", "content": json.dumps(requirements, indent=2)}],
        system=COST_HCL_SYSTEM,
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
            breakdown = _parse_infracost_output(cost_data)

        await websocket.send_text(json.dumps({
            "type": "cost_estimate",
            "data": breakdown,
        }))
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time)

    except Exception:
        await websocket.send_text(json.dumps({
            "type": "pipeline_event",
            "stage": "cost_analyst",
            "event": "infracost_fallback",
            "level": "warning",
            "message": "Infracost failed, using AI estimate fallback.",
        }))
        await _send_estimated_costs(requirements, websocket, start_time)


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


async def _send_estimated_costs(requirements: dict, websocket, start_time: float = 0) -> None:
    await emit_log(websocket, "cost_analyst", "Using AI cost estimation", start_time)
    prompt = "Estimate monthly AWS costs for this architecture:\n" + json.dumps(requirements)
    raw = await async_complete(
        messages=[{"role": "user", "content": prompt}],
        system=COST_ESTIMATE_SYSTEM,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        data = json.loads(raw)
        await websocket.send_text(json.dumps({"type": "cost_estimate", "data": data}))
        await emit_log(websocket, "cost_analyst", "Cost estimate ready", start_time)
    except (json.JSONDecodeError, Exception):
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
