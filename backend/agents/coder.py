import json
import asyncio
import logging
from typing import Any

from llm_client import _resolve_creds, async_complete
from agents.log_helper import emit_log
from agents.utils import enrich_requirements

logger = logging.getLogger(__name__)

EXPECTED_MIN_FILES = 4
ANTHROPIC_MAX_TOKENS = 16384
PRIMARY_REQUEST_TIMEOUT_SECONDS = 120
FALLBACK_REQUEST_TIMEOUT_SECONDS = 120

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

_CODER_SYSTEM_BASE = """You are a senior AWS infrastructure engineer generating production-ready Terraform for DrawToCloud.

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
- Call emit_terraform_file once per file. No prose between calls."""

_CODER_BUDGET_RULES = """
- Budget is a hard cap — minimize monthly cost while satisfying explicit requirements:
  - default to single region and single AZ unless compliance/uptime explicitly requires otherwise
  - pick smallest viable tiers/sizes by default (compute, database, cache)
  - avoid expensive defaults (NAT Gateway, multi-AZ databases, provisioned high-throughput settings, extra replicas) unless explicitly required"""

_JSON_FALLBACK_BASE = """You are generating a Terraform project for DrawToCloud.
Return a JSON array of files (no prose, no markdown fences):
[
  {"filename": "main.tf", "content": "...", "description": "..."},
  {"filename": "variables.tf", "content": "...", "description": "..."},
  {"filename": "outputs.tf", "content": "...", "description": "..."},
  {"filename": "terraform.tfvars", "content": "...", "description": "..."}
]
Use realistic AWS HCL. Valid JSON only."""

_JSON_FALLBACK_BUDGET_RULES = """
Budget is a hard cap — minimize monthly cost, default single region/single AZ, choose smallest viable tiers.
Avoid expensive defaults unless explicitly required by compliance/uptime/scale constraints."""


def _has_budget(requirements: dict) -> bool:
    return bool(requirements.get("monthly_budget") or requirements.get("budget_cap"))


def _build_coder_system_prompt(requirements: dict) -> str:
    prompt = _CODER_SYSTEM_BASE
    if _has_budget(requirements):
        prompt += _CODER_BUDGET_RULES
    return prompt


def _build_json_fallback_prompt(requirements: dict) -> str:
    prompt = _JSON_FALLBACK_BASE
    if _has_budget(requirements):
        prompt += _JSON_FALLBACK_BUDGET_RULES
    return prompt


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
    trace_id: str | None = None,
) -> None:
    filename = str(file_payload.get("filename") or f"file-{emitted_count}.tf")
    logger.info("coder.file_started trace_id=%s file=%s index=%d", trace_id, filename, emitted_count)
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
    await emit_log(websocket, "coder", f"Writing {filename}", start_time, trace_id=trace_id)

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
    logger.info("coder.file_emitted trace_id=%s file=%s index=%d", trace_id, filename, emitted_count)
    await asyncio.sleep(0.15)



async def stream_terraform_files(
    requirements: dict,
    websocket,
    start_time: float = 0,
    diagram_nodes: list | None = None,
    llm_creds: dict[str, Any] | None = None,
) -> None:
    start_loop_time = asyncio.get_running_loop().time()
    raw_trace = getattr(websocket, "trace_id", None)
    trace_id = raw_trace.strip() if isinstance(raw_trace, str) and raw_trace.strip() else None
    logger.info("coder.started trace_id=%s", trace_id)
    await emit_log(websocket, "coder", "Generating Terraform...", start_time, trace_id=trace_id)
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

    enriched = enrich_requirements(requirements, diagram_nodes)

    provider, model, api_key = _resolve_creds(llm_creds)

    emitted_count = 0
    if provider == "anthropic":
        try:
            emitted_count = await _stream_via_tool_use(
                enriched,
                websocket,
                model=model,
                api_key=api_key,
                start_time=start_time,
                start_loop_time=start_loop_time,
                trace_id=trace_id,
            )
        except asyncio.TimeoutError:
            logger.warning("coder.timeout_fallback trace_id=%s reason=tool_use_timeout", trace_id)
            await _emit_coder_event(
                websocket,
                "coder.timeout_fallback",
                "Coder request timed out, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Switching to fallback generator"},
            )
            emitted_count = await _stream_via_json_complete(
                enriched,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
                llm_creds=llm_creds,
                trace_id=trace_id,
            )
        except Exception:
            logger.error(
                "Coder tool-use path failed unexpectedly, falling back to JSON trace_id=%s",
                trace_id,
                exc_info=True,
            )
            await _emit_coder_event(
                websocket,
                "coder.parse_fallback",
                "Coder tool output failed, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Recovering from tool output failure"},
            )
            emitted_count = await _stream_via_json_complete(
                enriched,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
                llm_creds=llm_creds,
                trace_id=trace_id,
            )

        if emitted_count == 0:
            logger.warning("coder.parse_fallback trace_id=%s reason=no_files_emitted", trace_id)
            await _emit_coder_event(
                websocket,
                "coder.parse_fallback",
                "Coder returned no files, using JSON fallback",
                start_loop_time,
                level="warning",
                details={"activity": "Recovering empty tool output"},
            )
            emitted_count = await _stream_via_json_complete(
                enriched,
                websocket,
                start_time,
                start_loop_time,
                fallback=True,
                llm_creds=llm_creds,
                trace_id=trace_id,
            )
    else:
        emitted_count = await _stream_via_json_complete(
            enriched,
            websocket,
            start_time,
            start_loop_time,
            llm_creds=llm_creds,
            trace_id=trace_id,
        )

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
    logger.info("coder.completed trace_id=%s emitted_count=%d", trace_id, emitted_count)
    await emit_log(websocket, "coder", "Terraform ready", start_time, trace_id=trace_id)


async def _stream_via_tool_use(
    requirements: dict,
    websocket,
    model: str,
    api_key: str,
    start_time: float = 0,
    start_loop_time: float = 0,
    trace_id: str | None = None,
) -> int:
    import anthropic
    from anthropic.types import (
        InputJSONDelta,
        RawContentBlockStartEvent,
        RawContentBlockDeltaEvent,
        RawContentBlockStopEvent,
        RawMessageDeltaEvent,
        ToolUseBlock,
    )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform files from model",
        start_loop_time,
        details={"activity": "Generating Terraform with tool calls"},
    )

    emitted_count = 0
    # Track per-block state: which block indices are tool_use and their accumulated JSON
    tool_use_indices: dict[int, str] = {}  # index → accumulated partial_json
    stop_reason: str | None = None

    async with client.messages.stream(
            model=model,
            max_tokens=ANTHROPIC_MAX_TOKENS,
            system=_build_coder_system_prompt(requirements),
            tools=[EMIT_TERRAFORM_TOOL],
            messages=[{"role": "user", "content": json.dumps(requirements)}],
        ) as stream:
        async for event in stream:
            if isinstance(event, RawContentBlockStartEvent):
                if isinstance(event.content_block, ToolUseBlock) and event.content_block.name == "emit_terraform_file":
                    tool_use_indices[event.index] = ""

            elif isinstance(event, RawContentBlockDeltaEvent):
                if event.index in tool_use_indices and isinstance(event.delta, InputJSONDelta):
                    tool_use_indices[event.index] += event.delta.partial_json

            elif isinstance(event, RawContentBlockStopEvent):
                if event.index in tool_use_indices:
                    raw_json = tool_use_indices.pop(event.index)
                    try:
                        file_payload = json.loads(raw_json)
                    except json.JSONDecodeError:
                        logger.warning(
                            "coder.tool_block_parse_failed trace_id=%s index=%d",
                            trace_id, event.index,
                        )
                        continue
                    emitted_count += 1
                    await _emit_terraform_file_with_progress(
                        websocket, file_payload, emitted_count, start_time, trace_id,
                    )

            elif isinstance(event, RawMessageDeltaEvent):
                stop_reason = getattr(event.delta, "stop_reason", None)

    if stop_reason == "max_tokens":
        logger.warning(
            "Coder tool-use response truncated (stop_reason=max_tokens), emitted %d files trace_id=%s",
            emitted_count,
            trace_id,
        )

    return emitted_count


async def _stream_via_json_complete(
    requirements: dict,
    websocket,
    start_time: float = 0,
    start_loop_time: float = 0,
    fallback: bool = False,
    llm_creds: dict[str, Any] | None = None,
    trace_id: str | None = None,
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
    prompt = _build_json_fallback_prompt(requirements) + "\n\nRequirements:\n" + json.dumps(requirements, indent=2)
    try:
        raw = await asyncio.wait_for(
            async_complete(
                messages=[{"role": "user", "content": prompt}],
                system="Output valid JSON only. No prose, no markdown fences.",
                llm_creds=llm_creds,
                max_tokens=ANTHROPIC_MAX_TOKENS,
                log_context={"agent": "coder", "trace_id": trace_id},
            ),
            timeout=FALLBACK_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("coder.json_timeout trace_id=%s fallback=%s", trace_id, fallback)
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
        logger.warning("coder.json_parse_failed trace_id=%s fallback=%s", trace_id, fallback)
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
        await _emit_terraform_file_with_progress(websocket, file, emitted_count, start_time, trace_id)
    return emitted_count
