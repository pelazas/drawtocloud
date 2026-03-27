import json
import asyncio
import logging
from typing import Any

from llm_client import HTTP_CLIENT_TIMEOUT, _resolve_creds, async_complete
from agents.log_helper import emit_log
from agents.utils import enrich_requirements

logger = logging.getLogger(__name__)

EXPECTED_MIN_FILES = 4
ANTHROPIC_MAX_TOKENS = 16384
TOOL_USE_TIMEOUT_SECONDS = 180
FALLBACK_REQUEST_TIMEOUT_SECONDS = 180
JSON_SINGLE_FILE_DEFAULT_TIMEOUT_SECONDS = 35
JSON_SINGLE_FILE_MAX_CONCURRENCY = 2

REQUIRED_TERRAFORM_FILENAMES = (
    "main.tf",
    "variables.tf",
    "outputs.tf",
    "terraform.tfvars",
)
_REQUIRED_TERRAFORM_FILENAME_SET = set(REQUIRED_TERRAFORM_FILENAMES)

_JSON_SINGLE_FILE_MAX_TOKENS = {
    "main.tf": 3600,
    "variables.tf": 1800,
    "outputs.tf": 1200,
    "terraform.tfvars": 600,
}
_JSON_SINGLE_FILE_TIMEOUT_SECONDS = {
    "main.tf": 90,
    "variables.tf": 60,
    "outputs.tf": 50,
    "terraform.tfvars": 40,
}

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

_JSON_SINGLE_FILE_SYSTEM = """You are generating exactly one Terraform file for DrawToCloud.
Output valid JSON only (no prose, no markdown fences) in this exact shape:
{"filename": "<target-filename>", "content": "<full HCL content>", "description": "<short summary>"}
Never output extra files, paths, templates, shell scripts, or dotfiles."""

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


def _build_json_fallback_prompt(requirements: dict, required_filenames: tuple[str, ...] = REQUIRED_TERRAFORM_FILENAMES) -> str:
    prompt = _JSON_FALLBACK_BASE
    if _has_budget(requirements):
        prompt += _JSON_FALLBACK_BUDGET_RULES
    prompt += "\nOnly output these files: " + ", ".join(required_filenames) + "."
    return prompt


def _single_file_max_tokens(filename: str) -> int:
    return int(_JSON_SINGLE_FILE_MAX_TOKENS.get(filename, 2500))


def _single_file_timeout_seconds(filename: str) -> int:
    return int(_JSON_SINGLE_FILE_TIMEOUT_SECONDS.get(filename, JSON_SINGLE_FILE_DEFAULT_TIMEOUT_SECONDS))


def _truncate_requirement_value(value: Any, *, depth: int = 0) -> Any:
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, str):
        trimmed = value.strip()
        if len(trimmed) > 800:
            return trimmed[:800] + "...(truncated)"
        return trimmed
    if depth >= 2:
        return "<omitted>"
    if isinstance(value, list):
        return [_truncate_requirement_value(item, depth=depth + 1) for item in value[:8]]
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for key in list(value.keys())[:20]:
            if key in {"prompt", "analysis", "raw", "markdown", "html", "conversation", "messages", "chat_history"}:
                continue
            compact[str(key)] = _truncate_requirement_value(value[key], depth=depth + 1)
        return compact
    return str(value)[:200]


def _compact_requirements_for_single_file_mode(requirements: dict) -> dict[str, Any]:
    if not isinstance(requirements, dict):
        return {}

    preferred_keys = (
        "app_name",
        "app_type",
        "description",
        "monthly_budget",
        "budget_cap",
        "regions",
        "region",
        "environment",
        "services",
        "requirements",
        "constraints",
        "security",
        "scalability",
        "high_availability",
        "database",
        "compute",
        "storage",
        "networking",
    )
    compact: dict[str, Any] = {}
    for key in preferred_keys:
        if key in requirements:
            compact[key] = _truncate_requirement_value(requirements[key])

    diagram_nodes = requirements.get("diagram_nodes")
    if isinstance(diagram_nodes, list):
        summarized_nodes: list[dict[str, str]] = []
        for raw_node in diagram_nodes[:12]:
            if not isinstance(raw_node, dict):
                continue
            data = raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {}
            summarized_nodes.append(
                {
                    "id": str(raw_node.get("id") or ""),
                    "label": str(data.get("label") or raw_node.get("label") or ""),
                    "category": str(data.get("category") or raw_node.get("category") or ""),
                }
            )
        if summarized_nodes:
            compact["diagram_nodes"] = summarized_nodes

    if compact:
        return compact

    fallback: dict[str, Any] = {}
    for key in list(requirements.keys())[:25]:
        fallback[str(key)] = _truncate_requirement_value(requirements[key])
    return fallback


def _strip_markdown_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return raw.strip()


def _parse_json_payload(raw: str) -> tuple[Any, bool]:
    text = _strip_markdown_fences(raw)
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    candidate_starts = [index for index, char in enumerate(text) if char in "{["]
    for start in candidate_starts:
        try:
            parsed, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        has_extra_content = bool(text[start + end :].strip()) or start > 0
        return parsed, has_extra_content

    return json.loads(text), False


def _normalize_file_payload(
    file_payload: dict[str, Any],
    *,
    trace_id: str | None = None,
    expected_filename: str | None = None,
) -> dict[str, str] | None:
    filename = str(file_payload.get("filename") or "").strip()
    if expected_filename:
        if filename and filename != expected_filename:
            logger.warning(
                "coder.file_name_mismatch trace_id=%s expected=%s actual=%s",
                trace_id,
                expected_filename,
                filename,
            )
        filename = expected_filename

    if not filename:
        logger.warning("coder.file_dropped trace_id=%s reason=missing_filename", trace_id)
        return None

    if filename not in _REQUIRED_TERRAFORM_FILENAME_SET:
        logger.warning("coder.file_dropped trace_id=%s reason=disallowed_filename file=%s", trace_id, filename)
        return None

    return {
        "filename": filename,
        "content": str(file_payload.get("content") or ""),
        "description": str(file_payload.get("description") or ""),
    }


def _decode_single_file_payload(
    raw: str,
    *,
    trace_id: str | None = None,
    expected_filename: str | None = None,
) -> dict[str, str] | None:
    parsed, recovered = _parse_json_payload(raw)
    if recovered:
        logger.info(
            "coder.json_parse_recovered trace_id=%s file=%s mode=single_file",
            trace_id,
            expected_filename,
        )
    if isinstance(parsed, list):
        parsed = next((item for item in parsed if isinstance(item, dict)), None)
    if not isinstance(parsed, dict):
        logger.warning(
            "coder.json_parse_failed trace_id=%s reason=single_file_payload_not_object expected=%s",
            trace_id,
            expected_filename,
        )
        return None
    return _normalize_file_payload(parsed, trace_id=trace_id, expected_filename=expected_filename)


def _build_single_file_prompt(requirements: dict, filename: str) -> str:
    compact_requirements = _compact_requirements_for_single_file_mode(requirements)
    return (
        f"Generate only `{filename}`.\n"
        "Do not include any other file.\n"
        "Keep the file minimal, production-safe, and budget-aware.\n"
        "Use valid Terraform HCL.\n\n"
        "Requirements JSON:\n"
        f"{json.dumps(compact_requirements, separators=(',', ':'), ensure_ascii=True)}"
    )


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
    generation_mode = "anthropic_tool_use" if provider == "anthropic" else "bounded_json"
    logger.info(
        "coder.request_config trace_id=%s provider=%s model=%s mode=%s",
        trace_id,
        provider,
        model,
        generation_mode,
    )

    emitted_count = 0
    if provider == "anthropic":
        tool_use_completed = False
        try:
            emitted_count = await asyncio.wait_for(
                _stream_via_tool_use(
                    enriched,
                    websocket,
                    model=model,
                    api_key=api_key,
                    start_time=start_time,
                    start_loop_time=start_loop_time,
                    trace_id=trace_id,
                ),
                timeout=TOOL_USE_TIMEOUT_SECONDS,
            )
            tool_use_completed = True
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

        if tool_use_completed and emitted_count < EXPECTED_MIN_FILES:
            logger.warning(
                "coder.parse_fallback trace_id=%s reason=insufficient_files_emitted emitted_count=%d expected_min=%d",
                trace_id,
                emitted_count,
                EXPECTED_MIN_FILES,
            )
            await _emit_coder_event(
                websocket,
                "coder.parse_fallback",
                "Coder returned incomplete files, using JSON fallback",
                start_loop_time,
                level="warning",
                details={
                    "activity": "Recovering incomplete tool output",
                    "emitted_count": emitted_count,
                    "expected_min_files": EXPECTED_MIN_FILES,
                },
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
        emitted_count = await _stream_via_json_single_file_mode(
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

    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=HTTP_CLIENT_TIMEOUT)
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform files from model",
        start_loop_time,
        details={"activity": "Generating Terraform with tool calls"},
    )

    emitted_count = 0
    loop = asyncio.get_running_loop()
    stream_opened_at = 0.0
    first_event_logged = False
    event_count = 0
    last_block_completed_at: float | None = None
    emitted_filenames: set[str] = set()
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
        stream_opened_at = loop.time()
        logger.info("coder.tool_use.stream_opened trace_id=%s model=%s", trace_id, model)
        async for event in stream:
            event_count += 1
            if not first_event_logged:
                first_event_logged = True
                ttft_ms = max(int((loop.time() - stream_opened_at) * 1000), 0)
                logger.info("coder.tool_use.first_event trace_id=%s ttft_ms=%d", trace_id, ttft_ms)

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
                        parsed_payload = json.loads(raw_json)
                    except json.JSONDecodeError:
                        logger.warning(
                            "coder.tool_block_parse_failed trace_id=%s index=%d",
                            trace_id, event.index,
                        )
                        continue

                    file_payload = _normalize_file_payload(parsed_payload, trace_id=trace_id)
                    if not file_payload:
                        continue

                    filename = file_payload["filename"]
                    if filename in emitted_filenames:
                        logger.info("coder.file_dropped trace_id=%s reason=duplicate_file file=%s", trace_id, filename)
                        continue

                    emitted_count += 1
                    emitted_filenames.add(filename)
                    now = loop.time()
                    since_last_block_ms = 0
                    if last_block_completed_at is not None:
                        since_last_block_ms = max(int((now - last_block_completed_at) * 1000), 0)
                    logger.info(
                        "coder.tool_use.block_completed trace_id=%s file=%s json_size=%d since_last_block_ms=%d emitted_count=%d",
                        trace_id,
                        filename,
                        len(raw_json.encode("utf-8")),
                        since_last_block_ms,
                        emitted_count,
                    )
                    await _emit_terraform_file_with_progress(
                        websocket, file_payload, emitted_count, start_time, trace_id,
                    )
                    last_block_completed_at = loop.time()

            elif isinstance(event, RawMessageDeltaEvent):
                stop_reason = getattr(event.delta, "stop_reason", None)

    total_duration_ms = 0
    if stream_opened_at > 0:
        total_duration_ms = max(int((loop.time() - stream_opened_at) * 1000), 0)
    logger.info(
        "coder.tool_use.stream_done trace_id=%s duration_ms=%d event_count=%d emitted_count=%d stop_reason=%s",
        trace_id,
        total_duration_ms,
        event_count,
        emitted_count,
        stop_reason,
    )

    if stop_reason == "max_tokens":
        logger.warning(
            "Coder tool-use response truncated (stop_reason=max_tokens), emitted %d files trace_id=%s",
            emitted_count,
            trace_id,
        )

    return emitted_count


async def _stream_via_json_single_file_mode(
    requirements: dict,
    websocket,
    start_time: float = 0,
    start_loop_time: float = 0,
    llm_creds: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> int:
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform files via bounded JSON mode",
        start_loop_time,
        details={"activity": "Generating Terraform file-by-file"},
    )
    emitted_count = 0
    emitted_filenames: set[str] = set()
    semaphore = asyncio.Semaphore(JSON_SINGLE_FILE_MAX_CONCURRENCY)

    async def _request_single_file(filename: str) -> dict[str, str] | None:
        started_at = asyncio.get_running_loop().time()
        max_tokens = _single_file_max_tokens(filename)
        timeout_seconds = _single_file_timeout_seconds(filename)
        logger.info(
            "coder.json_single_file.request_started trace_id=%s file=%s timeout_seconds=%d max_tokens=%d",
            trace_id,
            filename,
            timeout_seconds,
            max_tokens,
        )
        async with semaphore:
            try:
                raw = await asyncio.wait_for(
                    async_complete(
                        messages=[{"role": "user", "content": _build_single_file_prompt(requirements, filename)}],
                        system=_JSON_SINGLE_FILE_SYSTEM,
                        llm_creds=llm_creds,
                        max_tokens=max_tokens,
                        log_context={"agent": "coder", "trace_id": trace_id},
                    ),
                    timeout=timeout_seconds,
                )
            except asyncio.TimeoutError:
                logger.warning("coder.json_timeout trace_id=%s fallback=False file=%s", trace_id, filename)
                return None
            except Exception:
                logger.exception("coder.json_single_file.failed trace_id=%s file=%s", trace_id, filename)
                return None

        payload = _decode_single_file_payload(raw, trace_id=trace_id, expected_filename=filename)
        if not payload:
            logger.warning("coder.file_dropped trace_id=%s reason=invalid_payload file=%s", trace_id, filename)
            return None
        logger.info(
            "coder.json_single_file.request_completed trace_id=%s file=%s elapsed_ms=%d",
            trace_id,
            filename,
            max(int((asyncio.get_running_loop().time() - started_at) * 1000), 0),
        )
        return payload

    tasks = [asyncio.create_task(_request_single_file(filename)) for filename in REQUIRED_TERRAFORM_FILENAMES]
    results = await asyncio.gather(*tasks)
    for payload in results:
        if not payload:
            continue
        filename = payload["filename"]
        if filename in emitted_filenames:
            logger.info("coder.file_dropped trace_id=%s reason=duplicate_file file=%s", trace_id, filename)
            continue
        emitted_count += 1
        emitted_filenames.add(filename)
        await _emit_terraform_file_with_progress(websocket, payload, emitted_count, start_time, trace_id)

    missing = tuple(filename for filename in REQUIRED_TERRAFORM_FILENAMES if filename not in emitted_filenames)
    if missing:
        logger.warning(
            "coder.parse_fallback trace_id=%s reason=missing_files_in_single_mode missing=%s",
            trace_id,
            ",".join(missing),
        )
        await _emit_coder_event(
            websocket,
            "coder.parse_fallback",
            "Bounded JSON mode returned incomplete files, using fallback",
            start_loop_time,
            level="warning",
            details={
                "activity": "Recovering missing Terraform files",
                "missing_files": list(missing),
                "emitted_count": emitted_count,
                "expected_min_files": EXPECTED_MIN_FILES,
            },
        )
        emitted_count += await _stream_via_json_complete(
            requirements,
            websocket,
            start_time,
            start_loop_time,
            fallback=True,
            llm_creds=llm_creds,
            trace_id=trace_id,
            required_filenames=missing,
            emitted_filenames=emitted_filenames,
            initial_emitted_count=emitted_count,
        )

    logger.info(
        "coder.json_single_file.completed trace_id=%s emitted_count=%d",
        trace_id,
        emitted_count,
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
    required_filenames: tuple[str, ...] = REQUIRED_TERRAFORM_FILENAMES,
    emitted_filenames: set[str] | None = None,
    initial_emitted_count: int = 0,
) -> int:
    logger.info(
        "coder.json.request_started trace_id=%s fallback=%s timeout_seconds=%d",
        trace_id,
        fallback,
        FALLBACK_REQUEST_TIMEOUT_SECONDS,
    )
    await _emit_coder_event(
        websocket,
        "coder.llm_request_started",
        "Requesting Terraform JSON payload",
        start_loop_time,
        details={
            "activity": "Generating Terraform via JSON fallback" if fallback else "Generating Terraform via JSON mode",
        },
    )
    prompt = (
        _build_json_fallback_prompt(requirements, required_filenames)
        + "\n\nRequirements:\n"
        + json.dumps(requirements, separators=(",", ":"), ensure_ascii=True)
    )
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
    raw = _strip_markdown_fences(raw)
    try:
        parsed, recovered = _parse_json_payload(raw)
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
    if recovered:
        logger.info("coder.json_parse_recovered trace_id=%s mode=json_complete fallback=%s", trace_id, fallback)

    if isinstance(parsed, dict):
        files: list[dict[str, Any]] = [parsed]
    elif isinstance(parsed, list):
        files = [item for item in parsed if isinstance(item, dict)]
    else:
        files = []

    emitted_count = initial_emitted_count
    emitted_by_filename: dict[str, dict[str, str]] = {}
    for file in files:
        payload = _normalize_file_payload(file, trace_id=trace_id)
        if not payload:
            continue
        filename = payload["filename"]
        if filename not in required_filenames:
            logger.info("coder.file_dropped trace_id=%s reason=unexpected_file file=%s", trace_id, filename)
            continue
        if emitted_filenames and filename in emitted_filenames:
            logger.info("coder.file_dropped trace_id=%s reason=already_emitted file=%s", trace_id, filename)
            continue
        if filename in emitted_by_filename:
            logger.info("coder.file_dropped trace_id=%s reason=duplicate_file file=%s", trace_id, filename)
            continue
        emitted_by_filename[filename] = payload

    emitted_before = emitted_count
    for required_filename in required_filenames:
        payload = emitted_by_filename.get(required_filename)
        if not payload:
            continue
        emitted_count += 1
        if emitted_filenames is not None:
            emitted_filenames.add(required_filename)
        await _emit_terraform_file_with_progress(websocket, payload, emitted_count, start_time, trace_id)
    logger.info(
        "coder.json.completed trace_id=%s fallback=%s response_size=%d emitted_count=%d required_count=%d",
        trace_id,
        fallback,
        len(raw.encode("utf-8")),
        emitted_count - emitted_before,
        len(required_filenames),
    )
    return emitted_count - emitted_before
