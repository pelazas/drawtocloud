import json
import asyncio
from llm_client import ACTIVE_PROVIDER, ACTIVE_MODEL, ACTIVE_KEY, async_complete

EMIT_TERRAFORM_TOOL = {
    "name": "emit_terraform_file",
    "description": "Emit a single Terraform file. Call once per file. Do not batch.",
    "input_schema": {
        "type": "object",
        "properties": {
            "filename":    {"type": "string", "description": "e.g. main.tf, variables.tf"},
            "content":     {"type": "string", "description": "Full HCL content"},
            "description": {"type": "string", "description": "One-sentence summary"}
        },
        "required": ["filename", "content", "description"]
    }
}

CODER_SYSTEM_PROMPT = """
You are a senior AWS infrastructure engineer generating production-ready Terraform for DrawToCloud.

Given a requirements JSON, call emit_terraform_file once per file. Required files:
- main.tf       — provider config + primary resources
- variables.tf  — all variables with types, descriptions, defaults
- outputs.tf    — useful outputs (ARNs, endpoints, IDs)
- terraform.tfvars — example values

Optional (only if needed): vpc.tf, compute.tf, database.tf, iam.tf, monitoring.tf

Rules:
- AWS provider ~> 5.0. All resources tagged: Name, Environment, Project="drawtocloud", ManagedBy="terraform"
- Variables for: region, environment, instance sizes. Data sources for AMIs — no hardcoded IDs.
- ECS: Fargate unless EC2 explicit. RDS: deletion_protection=false for mvp, true for prod.
- No placeholder values. Generate valid HCL that passes `terraform validate`.
- Call emit_terraform_file once per file. No prose between calls.
"""

JSON_FALLBACK_PROMPT = """
You are generating a Terraform project for DrawToCloud.
Return a JSON array of files (no prose, no markdown fences):
[
  {"filename": "main.tf", "content": "...", "description": "..."},
  {"filename": "variables.tf", "content": "...", "description": "..."},
  {"filename": "outputs.tf", "content": "...", "description": "..."},
  {"filename": "terraform.tfvars", "content": "...", "description": "..."}
]
Use realistic AWS HCL. Valid JSON only.
"""

async def stream_terraform_files(requirements: dict, websocket) -> None:
    if ACTIVE_PROVIDER == "anthropic":
        await _stream_via_tool_use(requirements, websocket)
    else:
        await _stream_via_json_complete(requirements, websocket)


async def _stream_via_tool_use(requirements: dict, websocket) -> None:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=ACTIVE_KEY)
    response = await client.messages.create(
        model=ACTIVE_MODEL,
        max_tokens=8192,
        system=CODER_SYSTEM_PROMPT,
        tools=[EMIT_TERRAFORM_TOOL],
        messages=[{"role": "user", "content": json.dumps(requirements)}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "emit_terraform_file":
            await websocket.send_text(json.dumps({
                "type": "terraform_file",
                "filename": block.input["filename"],
                "content": block.input["content"],
                "description": block.input.get("description", ""),
            }))
            await asyncio.sleep(0.3)


async def _stream_via_json_complete(requirements: dict, websocket) -> None:
    prompt = JSON_FALLBACK_PROMPT + "\n\nRequirements:\n" + json.dumps(requirements, indent=2)
    raw = await async_complete(
        messages=[{"role": "user", "content": prompt}],
        system="Output valid JSON only. No prose, no markdown fences.",
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    files = json.loads(raw)
    for file in files:
        await websocket.send_text(json.dumps({"type": "terraform_file", **file}))
        await asyncio.sleep(0.3)
