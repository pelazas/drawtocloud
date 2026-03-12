import json
import asyncio
from llm_client import ACTIVE_PROVIDER, ACTIVE_MODEL, ACTIVE_KEY, async_complete
from agents.log_helper import emit_log

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
- AWS provider ~> 5.0. All resources tagged: Name, Environment, Project=var.app_name, ManagedBy="terraform"
- Prefix resource logical names with the app_name (e.g. "${var.app_name}-vpc").
- Use app_name from requirements as the default for the app_name variable.
- variables.tf must declare: variable "app_name" { type = string; default = "<value from requirements>" }
- terraform.tfvars must include: app_name = "<value from requirements>"
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

async def stream_terraform_files(requirements: dict, websocket, start_time: float = 0) -> None:
    await emit_log(websocket, "coder", "Generating Terraform...", start_time)
    if ACTIVE_PROVIDER == "anthropic":
        await _stream_via_tool_use(requirements, websocket, start_time)
    else:
        await _stream_via_json_complete(requirements, websocket, start_time)
    await emit_log(websocket, "coder", "Terraform ready", start_time)


async def _stream_via_tool_use(requirements: dict, websocket, start_time: float = 0) -> None:
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
            filename = block.input["filename"]
            await websocket.send_text(json.dumps({
                "type": "terraform_file",
                "filename": filename,
                "content": block.input["content"],
                "description": block.input.get("description", ""),
            }))
            await emit_log(websocket, "coder", f"Writing {filename}", start_time)
            await asyncio.sleep(0.3)


async def _stream_via_json_complete(requirements: dict, websocket, start_time: float = 0) -> None:
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
        await emit_log(websocket, "coder", f"Writing {file['filename']}", start_time)
        await asyncio.sleep(0.3)
