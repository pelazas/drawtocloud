import json
import asyncio
from llm_client import ACTIVE_PROVIDER, ACTIVE_MODEL, ACTIVE_KEY, async_complete
from agents.log_helper import emit_log

EXPECTED_MIN_FILES = 4
ANTHROPIC_MAX_TOKENS = 4600
PRIMARY_REQUEST_TIMEOUT_SECONDS = 60
FALLBACK_REQUEST_TIMEOUT_SECONDS = 45

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
- Prefer exactly the required 4 files unless requirements explicitly demand extra split modules.
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


def _elapsed_ms(start_time: float) -> int:
    if start_time <= 0:
        return 0
    return max(int((asyncio.get_running_loop().time() - start_time) * 1000), 0)


async def _emit_coder_event(
    websocket,
    event: str,
    message: str,
    start_time: float,
    level: str = "info",
    details: dict | None = None,
) -> None:
    payload_details = {
        "activity": message,
        "elapsed_ms": _elapsed_ms(start_time),
        **(details or {}),
    }
    await websocket.send_text(
        json.dumps(
            {
                "type": "pipeline_event",
                "stage": "coder",
                "event": event,
                "level": level,
                "message": message,
                "details": payload_details,
            }
        )
    )


async def _emit_terraform_file_with_progress(
    websocket,
    file_payload: dict,
    emitted_count: int,
    start_time: float,
) -> None:
    filename = str(file_payload.get("filename") or f"file-{emitted_count}.tf")
    await websocket.send_text(
        json.dumps(
            {
                "type": "terraform_file",
                "filename": filename,
                "content": file_payload.get("content", ""),
                "description": file_payload.get("description", ""),
            }
        )
    )
    await emit_log(websocket, "coder", f"Writing {filename}", start_time)

    event_name = "coder.first_file_emitted" if emitted_count == 1 else "coder.file_emitted"
    await _emit_coder_event(
        websocket,
        event_name,
        f"Generated {filename}",
        start_time,
        details={
            "current_file": filename,
            "emitted_count": emitted_count,
            "expected_min_files": EXPECTED_MIN_FILES,
            "activity": f"Generating {filename}",
        },
    )
    await asyncio.sleep(0.15)


async def stream_terraform_files(requirements: dict, websocket, start_time: float = 0) -> None:
    start_loop_time = asyncio.get_running_loop().time()
    await emit_log(websocket, "coder", "Generating Terraform...", start_time)
    await _emit_coder_event(
        websocket,
        "coder.started",
        "Coder started Terraform generation",
        start_loop_time,
        details={
            "activity": "Planning Terraform files",
            "expected_min_files": EXPECTED_MIN_FILES,
            "emitted_count": 0,
        },
    )

    emitted_count = 0
    if ACTIVE_PROVIDER == "anthropic":
        try:
            emitted_count = await _stream_via_tool_use(requirements, websocket, start_time, start_loop_time)
        except asyncio.TimeoutError:
            await _emit_coder_event(
                websocket,
                "coder.timeout_fallback",
                "Coder request timed out, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Switching to fallback generator"},
            )
            emitted_count = await _stream_via_json_complete(
                requirements,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
            )
        except Exception:
            await _emit_coder_event(
                websocket,
                "coder.parse_fallback",
                "Coder tool output failed, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Recovering from tool output failure"},
            )
            emitted_count = await _stream_via_json_complete(
                requirements,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
            )

        if emitted_count == 0:
            await _emit_coder_event(
                websocket,
                "coder.parse_fallback",
                "Coder returned no files, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Recovering empty tool output"},
            )
            emitted_count = await _stream_via_json_complete(
                requirements,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
            )
    else:
        emitted_count = await _stream_via_json_complete(requirements, websocket, start_time, start_loop_time)

    await _emit_coder_event(
        websocket,
        "coder.completed",
        "Terraform generation completed",
        start_loop_time,
        details={
            "activity": "Finalizing Terraform files",
            "emitted_count": emitted_count,
            "expected_min_files": EXPECTED_MIN_FILES,
        },
    )
    await emit_log(websocket, "coder", "Terraform ready", start_time)


async def _stream_via_tool_use(
    requirements: dict,
    websocket,
    start_time: float = 0,
    start_loop_time: float = 0,
) -> int:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=ACTIVE_KEY)
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform files from model",
        start_loop_time,
        details={"activity": "Generating Terraform with tool calls"},
    )
    response = await asyncio.wait_for(
        client.messages.create(
            model=ACTIVE_MODEL,
            max_tokens=ANTHROPIC_MAX_TOKENS,
            system=CODER_SYSTEM_PROMPT,
            tools=[EMIT_TERRAFORM_TOOL],
            messages=[{"role": "user", "content": json.dumps(requirements)}],
        ),
        timeout=PRIMARY_REQUEST_TIMEOUT_SECONDS,
    )
    emitted_count = 0
    for block in response.content:
        if block.type == "tool_use" and block.name == "emit_terraform_file":
            emitted_count += 1
            await _emit_terraform_file_with_progress(websocket, block.input, emitted_count, start_time)
    return emitted_count


async def _stream_via_json_complete(
    requirements: dict,
    websocket,
    start_time: float = 0,
    start_loop_time: float = 0,
    fallback: bool = False,
) -> int:
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform JSON payload",
        start_loop_time,
        details={
            "activity": "Generating Terraform via JSON fallback" if fallback else "Generating Terraform via JSON mode",
        },
    )
    prompt = JSON_FALLBACK_PROMPT + "\n\nRequirements:\n" + json.dumps(requirements, indent=2)
    try:
        raw = await asyncio.wait_for(
            async_complete(
                messages=[{"role": "user", "content": prompt}],
                system="Output valid JSON only. No prose, no markdown fences.",
            ),
            timeout=FALLBACK_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        await _emit_coder_event(
            websocket,
            "coder.timeout_fallback",
            "Terraform JSON request timed out",
            start_loop_time,
            level="error",
            details={"activity": "Fallback request timed out"},
        )
        raise
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        files = json.loads(raw)
    except json.JSONDecodeError as error:
        await _emit_coder_event(
            websocket,
            "coder.parse_fallback",
            "Terraform JSON fallback response could not be parsed",
            start_loop_time,
            level="error",
            details={"activity": "Fallback parsing failed"},
        )
        raise error

    emitted_count = 0
    for file in files:
        if not isinstance(file, dict):
            continue
        emitted_count += 1
        await _emit_terraform_file_with_progress(websocket, file, emitted_count, start_time)
    return emitted_count
