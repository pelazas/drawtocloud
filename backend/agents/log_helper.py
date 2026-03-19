import json
import logging
import time

logger = logging.getLogger(__name__)


def log_agent_event(
    agent: str,
    event: str,
    *,
    level: str = "info",
    trace_id: str | None = None,
    duration_ms: int | None = None,
    **fields,
) -> None:
    payload = {
        "agent": agent,
        "event": event,
        "trace_id": trace_id,
        "duration_ms": duration_ms,
        **fields,
    }
    log_method = getattr(logger, level, logger.info)
    log_method("agent_event %s", event, extra={"agent_event": payload})


async def emit_log(
    websocket,
    agent: str,
    message: str,
    start_time: float,
    *,
    trace_id: str | None = None,
    details: dict | None = None,
) -> None:
    elapsed_raw = max(time.time() - start_time, 0.0)
    elapsed = round(elapsed_raw, 1)
    resolved_trace_id: str | None = None
    if isinstance(trace_id, str) and trace_id.strip():
        resolved_trace_id = trace_id.strip()
    else:
        websocket_trace = getattr(websocket, "trace_id", None)
        if isinstance(websocket_trace, str) and websocket_trace.strip():
            resolved_trace_id = websocket_trace.strip()
    payload = {
        "type": "agent_log",
        "agent": agent,
        "message": message,
        "elapsed": elapsed,
        "duration_ms": int(elapsed_raw * 1000),
        "trace_id": resolved_trace_id,
    }
    if isinstance(details, dict) and details:
        payload["details"] = details
    await websocket.send_text(json.dumps(payload))
