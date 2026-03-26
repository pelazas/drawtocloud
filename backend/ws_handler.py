import json
import logging
import re
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from auth import verify_access_token_user
from agents.cost_analyst import run_cost_analyst
from agents.chat_agent import extract_mutation_constraints, is_mutation_intent, stream_chat_reply
from agents.mutation_agent import run_mutation_agent
from agents.mutation_apply import GraphMutationApplyError, apply_graph_mutation
from generation_service import (
    broadcast_project_event,
    GenerationStartError,
    append_chat_history,
    rerun_project_agents_for_user,
    start_generation_for_user,
    subscribe_websocket,
    unsubscribe_websocket,
    unsubscribe_websocket_from_all,
)
from llm_keys import LlmKeyDecryptError, get_user_llm_key

logger = logging.getLogger(__name__)
from project_store import get_project_for_user, update_project_fields


class ClientDisconnectedError(Exception):
    """Raised when the websocket is closed and cannot accept outbound messages."""


def _is_send_after_close_error(error: Exception) -> bool:
    return isinstance(error, RuntimeError) and 'Cannot call "send" once a close message has been sent.' in str(error)


async def _safe_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
    except (WebSocketDisconnect, ConnectionResetError, BrokenPipeError):
        logger.warning("ws.send_failed reason=disconnected")
        return False
    except RuntimeError as error:
        if _is_send_after_close_error(error):
            logger.warning("ws.send_failed reason=closed_socket")
            return False
        raise
    return True


async def _safe_send_json(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    return await _safe_send_text(websocket, json.dumps(payload))


def _token_from_message(data: dict[str, Any]) -> str | None:
    token = data.get("access_token")
    if isinstance(token, str) and token.strip():
        return token

    fallback = data.get("auth_token")
    if isinstance(fallback, str) and fallback.strip():
        return fallback

    return None


def _project_id_from_message(data: dict[str, Any]) -> str | None:
    project_id = data.get("project_id")
    if isinstance(project_id, str) and project_id.strip():
        return project_id.strip()
    return None


def _client_ip_from_websocket(websocket: WebSocket) -> str | None:
    headers = getattr(websocket, "headers", None)
    if headers is not None and hasattr(headers, "get"):
        forwarded_for = headers.get("x-forwarded-for")
        if isinstance(forwarded_for, str) and forwarded_for.strip():
            first = forwarded_for.split(",")[0].strip()
            if first:
                return first

        real_ip = headers.get("x-real-ip")
        if isinstance(real_ip, str) and real_ip.strip():
            return real_ip.strip()

    host = getattr(getattr(websocket, "client", None), "host", None)
    if isinstance(host, str) and host.strip():
        return host.strip()

    return None


def _normalize_regions(data: dict[str, Any]) -> list[str]:
    """Accept regions list, or wrap legacy region string."""
    regions = data.get("regions")
    if isinstance(regions, list):
        normalized = [entry.strip() for entry in regions if isinstance(entry, str) and entry.strip()]
        if normalized:
            return normalized

    region = data.get("region")
    if isinstance(region, str) and region.strip():
        return [region.strip()]

    return []


def _normalize_generation_answers(raw_answers: Any) -> dict[str, Any]:
    if not isinstance(raw_answers, dict):
        answers: dict[str, Any] = {}
    else:
        answers = dict(raw_answers)
    answers["regions"] = _normalize_regions(answers)
    answers.pop("region", None)
    return answers


async def _send_project_ready(websocket: WebSocket, project_id: str, share_slug: str | None) -> bool:
    return await _safe_send_json(
        websocket,
        {
            "type": "project_ready",
            "project_id": project_id,
            "share_slug": share_slug,
        },
    )


async def _send_generation_snapshot(websocket: WebSocket, row: dict[str, Any]) -> bool:
    return await _safe_send_json(
        websocket,
        {
            "type": "generation_snapshot",
            "project_id": row.get("id"),
            "project_mode": row.get("project_mode"),
            "generation_status": row.get("generation_status"),
            "generation_stage": row.get("generation_stage"),
            "generation_error": row.get("generation_error"),
            "generation_trace_id": row.get("generation_trace_id"),
            "generation_started_at": row.get("generation_started_at"),
            "generation_completed_at": row.get("generation_completed_at"),
            "last_event_at": row.get("last_event_at"),
            "setup_pdf_status": row.get("setup_pdf_status"),
            "setup_pdf_progress": row.get("setup_pdf_progress"),
            "setup_pdf_error": row.get("setup_pdf_error"),
            "setup_pdf_generated_at": row.get("setup_pdf_generated_at"),
            "setup_pdf_source_revision": row.get("setup_pdf_source_revision"),
        },
    )


def _apply_canvas_edit(
    action: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    data: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
    """Apply a canvas edit mutation in-memory.

    Returns (updated_nodes, updated_edges) on success, or None if action is unknown.
    """
    if action == "remove_node":
        node_id = data.get("id")
        updated_nodes = [n for n in nodes if n.get("id") != node_id]
        updated_edges = [
            e for e in edges
            if e.get("source") != node_id and e.get("target") != node_id
        ]
        return updated_nodes, updated_edges

    if action == "add_node":
        label = str(data.get("label", "node"))
        category = str(data.get("category", "compute"))
        node_id = f"{label.lower().replace(' ', '_')}_{uuid4().hex[:6]}"
        new_node: dict[str, Any] = {
            "id": node_id,
            "type": "default",
            "data": {"label": label, "category": category},
        }
        return [*nodes, new_node], list(edges)

    if action == "rename_node":
        node_id = data.get("id")
        new_label = data.get("label", "")
        updated_nodes = [
            {**n, "data": {**n.get("data", {}), "label": new_label}}
            if n.get("id") == node_id
            else n
            for n in nodes
        ]
        return updated_nodes, list(edges)

    return None


def _format_mutation_failure_message(error: Exception) -> str:
    message = str(error).strip()
    if not message:
        message = "The requested mutation could not be applied safely."
    return (
        "I couldn't apply that change safely. "
        f"{message} "
        "Try a narrower instruction (for example, target one selected node and desired outcome)."
    )


def _mutation_scope(selected_node_ids: list[str]) -> str:
    return "selected" if selected_node_ids else "all"


def _selected_nodes_metadata(
    project_row: dict[str, Any],
    selected_node_ids: list[str],
) -> list[dict[str, str]]:
    if not selected_node_ids:
        return []

    nodes = project_row.get("nodes")
    if not isinstance(nodes, list):
        return [{"id": node_id, "label": node_id, "category": "default"} for node_id in selected_node_ids]

    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            by_id[node["id"]] = node

    selected: list[dict[str, str]] = []
    for node_id in selected_node_ids:
        node = by_id.get(node_id)
        data = node.get("data") if isinstance(node, dict) and isinstance(node.get("data"), dict) else {}
        label = data.get("label") if isinstance(data.get("label"), str) and data.get("label").strip() else node_id
        category = (
            data.get("category")
            if isinstance(data.get("category"), str) and data.get("category").strip()
            else "default"
        )
        selected.append({"id": node_id, "label": label, "category": category})
    return selected


def _build_mutation_reply_message(
    assistant_message: str,
    summary: dict[str, Any],
    reasoning: str,
) -> str:
    message = assistant_message.strip()
    if message:
        return message

    parts = []
    nodes_added = int(summary.get("nodes_added", 0))
    nodes_edited = int(summary.get("nodes_edited", 0))
    nodes_deleted = int(summary.get("nodes_deleted", 0))
    edges_added = int(summary.get("edges_added", 0))
    edges_edited = int(summary.get("edges_edited", 0))
    edges_deleted = int(summary.get("edges_deleted", 0))
    if nodes_added:
        parts.append(f"added {nodes_added} node(s)")
    if nodes_edited:
        parts.append(f"edited {nodes_edited} node(s)")
    if nodes_deleted:
        parts.append(f"deleted {nodes_deleted} node(s)")
    if edges_added:
        parts.append(f"added {edges_added} edge(s)")
    if edges_edited:
        parts.append(f"edited {edges_edited} edge(s)")
    if edges_deleted:
        parts.append(f"removed {edges_deleted} edge(s)")
    if not parts:
        return "No graph changes were needed."
    why = reasoning.strip()
    if why:
        return f"I {', '.join(parts)}. {why}"
    return f"I {', '.join(parts)}."


def _is_plan_only_request(message: str) -> bool:
    normalized = message.lower()
    return any(
        phrase in normalized
        for phrase in (
            "provide a plan",
            "give me a plan",
            "show me a plan",
            "plan to",
        )
    )


def _is_architecture_wide_request(message: str) -> bool:
    normalized = message.lower()
    if any(
        phrase in normalized
        for phrase in (
            "whole architecture",
            "entire architecture",
            "overall architecture",
            "redo architecture",
            "re-do architecture",
            "rebuild architecture",
            "re-architect",
            "rearchitect",
            "architecture to be cheaper",
            "architecture cheaper",
            "more simple",
            "simpler architecture",
            "change the architecture",
            "redesign",
            "refactor the architecture",
            "without secrets manager",
            "remove secrets manager",
        )
    ):
        return True

    if "architecture" in normalized and re.search(r"\b(redo|re-do|redesign|refactor|re-architect|rearchitect|replace)\b", normalized):
        return True

    # Common refactor phrasing that doesn't include the word "architecture".
    if re.search(r"\breplace\b.+\bwith\b", normalized):
        return True

    return False


def _contains_explicit_insecure_secrets_request(message: str) -> bool:
    normalized = message.lower()
    return any(
        phrase in normalized
        for phrase in (
            "store secrets in ec2",
            "secrets on ec2",
            "without secrets manager",
            "remove secrets manager",
            "no secrets manager",
        )
    )


def _classify_execution_mode(message: str, selected_node_ids: list[str]) -> str:
    del selected_node_ids
    if _is_plan_only_request(message):
        return "plan_only"
    if _is_architecture_wide_request(message):
        return "architecture_refactor"
    if is_mutation_intent(message):
        return "node_patch"
    return "chat_only"


_VARIABLE_COST_KEYWORDS = (
    "api gateway",
    "cloudfront",
    "lambda",
    "sqs",
    "sns",
    "alb",
    "load balancer",
    "waf",
    "cloudwatch",
)
_DATABASE_COST_KEYWORDS = (
    "rds",
    "aurora",
    "dynamodb",
    "elasticache",
    "redis",
)
_COMPUTE_COST_KEYWORDS = ("ec2", "ecs", "eks", "fargate")


def _numeric_with_multiplier(value: str | None, unit: str | None) -> float | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace(",", "")
    if not normalized:
        return None
    try:
        number = float(normalized)
    except ValueError:
        return None
    suffix = (unit or "").strip().lower()
    if suffix in {"k"}:
        number *= 1_000
    elif suffix in {"m", "million"}:
        number *= 1_000_000
    elif suffix in {"b", "billion"}:
        number *= 1_000_000_000
    return number


def _extract_usage_inputs(text: str) -> dict[str, float]:
    normalized = text.lower()
    usage: dict[str, float] = {}

    req_match = re.search(
        r"(\d+(?:\.\d+)?)\s*(k|m|b|million|billion)?\s*(?:requests?|reqs?)",
        normalized,
    )
    if req_match:
        requests_per_month = _numeric_with_multiplier(req_match.group(1), req_match.group(2))
        if requests_per_month is not None:
            usage["requests_per_month"] = requests_per_month

    users_match = re.search(
        r"(\d+(?:\.\d+)?)\s*(k|m|million)?\s*(?:monthly active users|mau|active users|users?)",
        normalized,
    )
    if users_match:
        monthly_active_users = _numeric_with_multiplier(users_match.group(1), users_match.group(2))
        if monthly_active_users is not None:
            usage["monthly_active_users"] = monthly_active_users

    traffic_match = re.search(
        r"(\d+(?:\.\d+)?)\s*(tb|gb|pb)\s*(?:traffic|bandwidth|data transfer)?",
        normalized,
    )
    if traffic_match:
        traffic_value = _numeric_with_multiplier(traffic_match.group(1), None)
        if traffic_value is not None:
            unit = traffic_match.group(2).lower()
            if unit == "tb":
                traffic_value *= 1_000
            elif unit == "pb":
                traffic_value *= 1_000_000
            usage["monthly_traffic_gb"] = traffic_value

    return usage


def _extract_usage_inputs_from_history(history: list[dict[str, Any]]) -> dict[str, float]:
    usage: dict[str, float] = {}
    for entry in reversed(history[-10:]):
        if not isinstance(entry, dict):
            continue
        if entry.get("role") != "user":
            continue
        content = entry.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        extracted = _extract_usage_inputs(content)
        for key, value in extracted.items():
            if key not in usage:
                usage[key] = value
        if {
            "requests_per_month",
            "monthly_active_users",
            "monthly_traffic_gb",
        }.issubset(usage.keys()):
            break
    return usage


def _is_complete_usage_profile(usage: dict[str, float]) -> bool:
    return all(
        key in usage and usage[key] > 0
        for key in ("requests_per_month", "monthly_active_users", "monthly_traffic_gb")
    )


def _to_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _cost_items_from_project(project_row: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    estimate = project_row.get("cost_estimate")
    if not isinstance(estimate, dict):
        return [], "USD"

    currency = estimate.get("currency")
    currency_code = currency.strip().upper() if isinstance(currency, str) and currency.strip() else "USD"
    parsed: list[dict[str, Any]] = []

    direct_items = estimate.get("items")
    if isinstance(direct_items, list):
        for item in direct_items:
            if not isinstance(item, dict):
                continue
            label = item.get("label")
            cost = _to_number(item.get("cost"))
            if not isinstance(label, str) or not label.strip() or cost is None or cost < 0:
                continue
            parsed.append({"label": label.strip(), "cost": round(cost, 2)})

    line_items = estimate.get("line_items")
    if not parsed and isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            service = item.get("service")
            resource = item.get("resource_type")
            cost = _to_number(item.get("monthly_cost"))
            if cost is None or cost < 0:
                continue
            if isinstance(service, str) and service.strip():
                label = service.strip()
                if isinstance(resource, str) and resource.strip():
                    label = f"{label} ({resource.strip()})"
            elif isinstance(resource, str) and resource.strip():
                label = resource.strip()
            else:
                label = "Unlabeled service"
            parsed.append({"label": label, "cost": round(cost, 2)})

    return parsed, currency_code


def _base_monthly_total(project_row: dict[str, Any], items: list[dict[str, Any]]) -> float:
    estimate = project_row.get("cost_estimate")
    if isinstance(estimate, dict):
        explicit_total = _to_number(estimate.get("monthly_total"))
        if explicit_total is not None and explicit_total >= 0:
            return round(explicit_total, 2)
    return round(sum(float(entry["cost"]) for entry in items), 2)


def _cost_split(label: str) -> tuple[float, float]:
    lowered = label.lower()
    if any(keyword in lowered for keyword in _VARIABLE_COST_KEYWORDS):
        return 0.15, 0.85
    if any(keyword in lowered for keyword in _DATABASE_COST_KEYWORDS):
        return 0.65, 0.35
    if any(keyword in lowered for keyword in _COMPUTE_COST_KEYWORDS):
        return 0.45, 0.55
    return 0.75, 0.25


def _usage_factor(usage: dict[str, float]) -> float:
    req_factor = min(max(usage.get("requests_per_month", 1_000_000) / 1_000_000, 0.5), 8.0)
    users_factor = min(max(usage.get("monthly_active_users", 10_000) / 10_000, 0.5), 8.0)
    traffic_factor = min(max(usage.get("monthly_traffic_gb", 1_000) / 1_000, 0.5), 8.0)
    return round((req_factor * 0.45) + (users_factor * 0.3) + (traffic_factor * 0.25), 2)


def _usage_scaled_pricing(
    items: list[dict[str, Any]],
    usage: dict[str, float],
    base_total: float,
) -> dict[str, Any]:
    if not items:
        return {
            "baseline_total": base_total,
            "expected_total": base_total,
            "peak_total": round(base_total * 1.3, 2),
            "line_items": [],
        }

    factor = _usage_factor(usage)
    expected_line_items: list[dict[str, Any]] = []
    expected_total = 0.0
    for item in items:
        cost = float(item["cost"])
        fixed_ratio, variable_ratio = _cost_split(str(item["label"]))
        fixed_cost = cost * fixed_ratio
        variable_cost = cost * variable_ratio
        expected_cost = fixed_cost + (variable_cost * factor)
        expected_line_items.append(
            {
                "label": str(item["label"]),
                "baseline_cost": round(cost, 2),
                "expected_cost": round(expected_cost, 2),
            }
        )
        expected_total += expected_cost

    peak_total = round(expected_total * 1.45, 2)
    return {
        "baseline_total": round(base_total, 2),
        "expected_total": round(expected_total, 2),
        "peak_total": peak_total,
        "line_items": sorted(expected_line_items, key=lambda entry: entry["expected_cost"], reverse=True),
    }


def _build_architecture_refactor_response(
    *,
    user_message: str,
    project_row: dict[str, Any],
    prior_history: list[dict[str, Any]],
    include_security_warning: bool,
) -> tuple[str, bool, dict[str, Any] | None]:
    warning = ""
    if include_security_warning:
        warning = (
            "Security warning: this request weakens secret-management protections. "
            "Prefer IAM roles and KMS-managed encryption when possible.\n\n"
        )

    cost_items, currency = _cost_items_from_project(project_row)
    base_total = _base_monthly_total(project_row, cost_items)
    top_items = sorted(cost_items, key=lambda entry: entry["cost"], reverse=True)[:3]

    usage = _extract_usage_inputs_from_history(prior_history)
    usage.update(_extract_usage_inputs(user_message))

    if not _is_complete_usage_profile(usage):
        if top_items:
            top_lines = "\n".join(
                f"- {entry['label']}: ~{entry['cost']:.2f} {currency}/month"
                for entry in top_items
            )
            summary = (
                "Highest monthly cost contributors right now:\n"
                f"{top_lines}\n\n"
                f"Current baseline estimate: ~{base_total:.2f} {currency}/month.\n\n"
            )
        else:
            summary = (
                "I don't have enough line-item pricing to rank exact cost drivers yet.\n\n"
            )

        question = (
            "Cost depends heavily on workload assumptions. "
            "Share your expected requests per month, monthly active users, and monthly traffic (GB/TB), "
            "and I’ll return updated pricing plus cheaper architecture options."
        )
        return f"{warning}{summary}{question}", False, None

    pricing = _usage_scaled_pricing(cost_items, usage, base_total)
    expected_items = pricing["line_items"][:5]
    pricing_lines = "\n".join(
        f"- {entry['label']}: ~{entry['expected_cost']:.2f} {currency}/month (baseline ~{entry['baseline_cost']:.2f})"
        for entry in expected_items
    )

    option_a_total = round(pricing["expected_total"] * 0.82, 2)
    option_b_total = round(pricing["expected_total"] * 0.66, 2)
    option_a_change = (
        "Option A (recommended): right-size compute/database tiers, keep current reliability pattern."
    )
    option_b_change = (
        "Option B (aggressive savings): reduce redundancy and managed add-ons where acceptable."
    )

    requested_change = (
        f"{user_message.strip()} | "
        f"assumptions: requests/month={int(usage['requests_per_month'])}, "
        f"MAU={int(usage['monthly_active_users'])}, "
        f"traffic_gb={int(usage['monthly_traffic_gb'])} | "
        f"recommended=Option A (~{option_a_total:.2f} {currency}/month)"
    )
    plan_meta = {
        "plan_id": str(uuid4()),
        "type": "architecture_refactor",
        "status": "pending",
        "requested_change": requested_change,
    }

    message = (
        f"{warning}"
        "Updated monthly pricing (usage-adjusted):\n"
        f"- Baseline: ~{pricing['baseline_total']:.2f} {currency}/month\n"
        f"- Expected: ~{pricing['expected_total']:.2f} {currency}/month\n"
        f"- Peak: ~{pricing['peak_total']:.2f} {currency}/month\n\n"
        "Updated pricing list:\n"
        f"{pricing_lines}\n\n"
        f"{option_a_change}\n"
        f"Estimated after changes: ~{option_a_total:.2f} {currency}/month.\n\n"
        f"{option_b_change}\n"
        f"Estimated after changes: ~{option_b_total:.2f} {currency}/month.\n\n"
        "If this direction looks right, approve and I'll apply the recommended architecture update."
    )
    return message, True, plan_meta


def _find_pending_architecture_plan(
    history: list[dict[str, Any]],
    plan_id: str | None = None,
) -> dict[str, Any] | None:
    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue
        plan_meta = entry.get("plan_meta")
        if not isinstance(plan_meta, dict):
            continue
        if plan_meta.get("type") != "architecture_refactor":
            continue
        candidate_id = plan_meta.get("plan_id")
        if plan_id and candidate_id != plan_id:
            continue
        status = plan_meta.get("status")
        if status in {"approved", "executed", "rejected", "cancelled"}:
            return None
        if status == "pending":
            return plan_meta
    return None


def _build_full_rerun_answers(
    project_row: dict[str, Any],
    user_message: str,
    prior_history: list[dict[str, Any]],
) -> dict[str, Any]:
    base_answers = project_row.get("questionnaire_answers")
    answers = _normalize_generation_answers(base_answers)
    history_lines: list[str] = []
    for entry in prior_history[-10:]:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            history_lines.append(f"{role}: {content.strip()}")
    history_lines.append(f"user: {user_message.strip()}")
    answers["conversation_summary"] = "\n".join(history_lines)
    answers["_approved_plan"] = True
    return answers


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Main WebSocket handler. Routes messages by type.

    Accepted message types:
      - start_generation:     { type, answers, access_token|auth_token, project_id? }
      - subscribe_project:    { type, project_id, access_token|auth_token }
      - chat:                 { type, message, access_token|auth_token, project_id?, selected_node_ids?, nodes?, edges? }
      - canvas_edit:          { type, action, access_token|auth_token, project_id?, ... }
      - generate_terraform:   { type, project_id, access_token|auth_token }
      - chat_plan_approve:    { type, project_id, plan_id, access_token|auth_token, requested_change? }

    Emitted message types:
      - project_ready:      { type, project_id, share_slug }
      - generation_started: { type, project_id, trace_id, generation_status }
      - generation_snapshot:{ type, project_id, generation_* }
      - canvas_edit_ack:   { type, project_id, action, node_id? }
      - pipeline_event:     { type, project_id, trace_id, stage, event, level, message, ts, details? }
      - status:             { type, project_id, trace_id, message }
      - agent_log:          { type, project_id, trace_id, agent, message, elapsed, duration_ms, details? }
      - diagram_event:      { type, project_id, trace_id, action, ... }
      - terraform_file:     { type, project_id, trace_id, filename, content, description }
      - arch_description:   { type, project_id, trace_id, sections }
      - cost_estimate:      { type, project_id, region, monthly_total, items[] }
      - setup_pdf_status:  { type, project_id, setup_pdf_status, setup_pdf_progress, setup_pdf_error?, setup_pdf_generated_at?, setup_pdf_source_revision? }
      - done:               { type, project_id, trace_id }
      - chat_reply_delta:   { type, project_id, delta }
      - chat_reply_done:    { type, project_id, message, mutation?, execution_mode?, plan_ready?, plan_meta? }
      - error:              { type, error, message }
    """

    subscribed_projects: set[str] = set()
    client_host = getattr(getattr(websocket, "client", None), "host", "unknown")
    client_port = getattr(getattr(websocket, "client", None), "port", "unknown")
    logger.info("ws.connected client=%s:%s", client_host, client_port)

    while True:
        try:
            raw = await websocket.receive_text()
        except WebSocketDisconnect:
            logger.info("ws.disconnected client=%s:%s reason=websocket_disconnect", client_host, client_port)
            break
        except Exception as exc:
            logger.warning("WebSocket receive_text failed unexpectedly: %s", exc)
            break

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            if not await _safe_send_json(websocket, {"type": "error", "error": "invalid_json"}):
                break
            continue

        msg_type = data.get("type")
        logger.info("ws.message_received type=%s client=%s:%s", msg_type, client_host, client_port)
        user_id: str | None = None
        user_email: str | None = None

        if msg_type in {
            "start_generation",
            "subscribe_project",
            "chat",
            "canvas_edit",
            "generate_terraform",
            "chat_plan_approve",
        }:
            token = _token_from_message(data)
            if token is None:
                logger.warning("ws.auth_failed reason=missing_token type=%s", msg_type)
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "unauthenticated",
                        "message": "Missing access token. Please sign in again.",
                    },
                ):
                    break
                continue

            auth_user = await verify_access_token_user(token)
            if auth_user is None:
                logger.warning("ws.auth_failed reason=invalid_token type=%s", msg_type)
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_token",
                        "message": "Session expired or invalid. Please sign in again.",
                    },
                ):
                    break
                continue
            user_id = auth_user.user_id
            user_email = auth_user.email
            logger.info("ws.auth_ok user_id=%s type=%s", user_id, msg_type)

        if msg_type == "start_generation":
            answers = _normalize_generation_answers(data.get("answers", {}))
            project_id = _project_id_from_message(data)
            client_ip = _client_ip_from_websocket(websocket)

            try:
                result = await start_generation_for_user(
                    user_id or "",
                    user_email or "",
                    answers,
                    project_id,
                    client_ip=client_ip,
                )
            except GenerationStartError as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": error.code,
                        "message": error.message,
                    },
                ):
                    break
                continue
            except Exception as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "generation_start_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

            started_project_id = str(result["project_id"])
            if result.get("created_project"):
                if not await _send_project_ready(
                    websocket,
                    started_project_id,
                    result.get("share_slug") if isinstance(result.get("share_slug"), str) else None,
                ):
                    break

            await subscribe_websocket(started_project_id, websocket)
            subscribed_projects.add(started_project_id)

            if not await _safe_send_json(
                websocket,
                {
                    "type": "generation_started",
                    "project_id": started_project_id,
                    "trace_id": result.get("trace_id"),
                    "generation_status": result.get("generation_status"),
                },
            ):
                break

        elif msg_type == "subscribe_project":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_project_id",
                        "message": "Missing project_id for subscription.",
                    },
                ):
                    break
                continue

            try:
                row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            await subscribe_websocket(project_id, websocket)
            subscribed_projects.add(project_id)

            if not await _send_generation_snapshot(websocket, row):
                break

        elif msg_type == "chat":
            project_id = _project_id_from_message(data)
            chat_text = data.get("message")
            raw_selected_node_ids = data.get("selected_node_ids")
            selected_node_ids = (
                [entry.strip() for entry in raw_selected_node_ids if isinstance(entry, str) and entry.strip()]
                if isinstance(raw_selected_node_ids, list)
                else []
            )

            if not isinstance(chat_text, str) or not chat_text.strip():
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "invalid_chat_message",
                        "message": "Chat message must be a non-empty string.",
                    },
                ):
                    break
                continue

            llm_creds = None
            if user_id:
                try:
                    llm_creds = await get_user_llm_key(user_id)
                except LlmKeyDecryptError as error:
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "error": "llm_key_decrypt_failed",
                            "message": str(error),
                        },
                    ):
                        break
                    continue
                except Exception:
                    llm_creds = None

            user_message = chat_text.strip()
            is_projectless_chat = project_id is None
            if is_projectless_chat:
                incoming_nodes = data.get("nodes")
                incoming_edges = data.get("edges")
                project_row = {
                    "id": None,
                    "nodes": [node for node in incoming_nodes if isinstance(node, dict)] if isinstance(incoming_nodes, list) else [],
                    "edges": [edge for edge in incoming_edges if isinstance(edge, dict)] if isinstance(incoming_edges, list) else [],
                    "chat_history": [],
                    "questionnaire_answers": {},
                    "generation_status": "completed",
                    "generation_stage": "completed",
                }
            else:
                try:
                    project_row = await get_project_for_user(project_id, user_id or "")
                except Exception:
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "error": "project_not_found",
                            "message": "Project not found.",
                        },
                    ):
                        break
                    continue

            prior_history = project_row.get("chat_history") if isinstance(project_row.get("chat_history"), list) else []
            selected_nodes_meta = _selected_nodes_metadata(project_row, selected_node_ids)

            if project_id is not None:
                try:
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "user",
                        user_message,
                        metadata={"selected_nodes": selected_nodes_meta} if selected_nodes_meta else None,
                    )
                except Exception:
                    pass

            assistant_chunks: list[str] = []
            plan_ready_flag = False
            plan_meta: dict[str, Any] | None = None
            execution_mode = "chat_only"
            mutation_intent = False
            try:
                execution_mode = _classify_execution_mode(user_message, selected_node_ids)
                if is_projectless_chat and execution_mode == "node_patch":
                    # Projectless sessions cannot mutate persisted state.
                    execution_mode = "chat_only"
                mutation_intent = execution_mode == "node_patch"

                if execution_mode == "architecture_refactor":
                    include_warning = _contains_explicit_insecure_secrets_request(user_message)
                    assistant_message, plan_ready_flag, plan_meta = _build_architecture_refactor_response(
                        user_message=user_message,
                        project_row=project_row,
                        prior_history=prior_history,
                        include_security_warning=include_warning,
                    )

                    reply_payload: dict[str, Any] = {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": execution_mode,
                    }
                    if plan_ready_flag:
                        reply_payload["plan_ready"] = True
                    if plan_meta:
                        reply_payload["plan_meta"] = plan_meta

                    if not await _safe_send_json(websocket, reply_payload):
                        break
                    if project_id is not None:
                        try:
                            assistant_metadata: dict[str, Any] = {
                                "execution_mode": execution_mode,
                            }
                            if plan_ready_flag:
                                assistant_metadata["plan_ready"] = True
                            if plan_meta:
                                assistant_metadata["plan_meta"] = plan_meta
                            await append_chat_history(
                                project_id,
                                user_id or "",
                                "assistant",
                                assistant_message,
                                metadata=assistant_metadata,
                            )
                        except Exception:
                            pass
                    continue

                if execution_mode == "node_patch":
                    mutation_constraints = extract_mutation_constraints(user_message, selected_node_ids)
                    mutation_plan = await run_mutation_agent(
                        user_goal=user_message,
                        project_state=project_row,
                        selected_node_ids=selected_node_ids,
                        history=prior_history,
                        llm_creds=llm_creds,
                        user_constraints=mutation_constraints,
                    )
                    applied = apply_graph_mutation(
                        nodes=list(project_row.get("nodes") or []),
                        edges=list(project_row.get("edges") or []),
                        diff=mutation_plan.diff,
                        selected_node_ids=selected_node_ids,
                    )

                    await update_project_fields(
                        project_id,
                        user_id or "",
                        {
                            "nodes": applied["nodes"],
                            "edges": applied["edges"],
                            **(
                                {"setup_pdf_status": "outdated"}
                                if project_row.get("setup_pdf_status") in {"ready", "outdated"}
                                else {}
                            ),
                        },
                    )

                    assistant_message = _build_mutation_reply_message(
                        assistant_message=mutation_plan.assistant_message,
                        summary=applied["summary"],
                        reasoning=mutation_plan.reasoning,
                    )
                    if _contains_explicit_insecure_secrets_request(user_message):
                        assistant_message = (
                            "Security warning: this change may weaken secret handling. "
                            "I applied the request as asked; consider IAM roles + KMS as a safer default.\n\n"
                            f"{assistant_message}"
                        )
                    rerun_agents = ["coder"]
                    rerun_result = await rerun_project_agents_for_user(
                        user_id=user_id or "",
                        user_email=user_email or "",
                        project_id=project_id,
                        agent_names=rerun_agents,
                        user_message=user_message,
                    )
                    rerun_trace = rerun_result.get("trace_id")
                    rerun_suffix = f" (trace {rerun_trace})" if isinstance(rerun_trace, str) and rerun_trace else ""
                    assistant_message = (
                        f"{assistant_message}\n\n"
                        f"I’m re-running {', '.join(rerun_agents)} to refresh Terraform outputs{rerun_suffix}."
                    )
                    reply_payload = {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": execution_mode,
                        "mutation": {
                            "diff": applied["normalized_diff"],
                            "summary": applied["summary"],
                            "scope": _mutation_scope(selected_node_ids),
                        },
                    }
                    if not await _safe_send_json(websocket, reply_payload):
                        break

                    if project_id is not None:
                        try:
                            await append_chat_history(
                                project_id,
                                user_id or "",
                                "assistant",
                                assistant_message,
                                metadata={"execution_mode": execution_mode},
                            )
                        except Exception:
                            pass
                    continue

                async for chunk in stream_chat_reply(
                    user_message,
                    prior_history,
                    project_row,
                    llm_creds=llm_creds,
                    selected_node_ids=selected_node_ids,
                ):
                    assistant_chunks.append(chunk)
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "chat_reply_delta",
                            "project_id": project_id,
                            "delta": chunk,
                        },
                    ):
                        break

                raw_message = "".join(assistant_chunks)
                assistant_message = raw_message.strip()

                if not assistant_message:
                    assistant_message = "I could not generate a response from the current context."

                reply_payload: dict[str, Any] = {
                    "type": "chat_reply_done",
                    "project_id": project_id,
                    "message": assistant_message,
                    "execution_mode": execution_mode,
                }
                if plan_ready_flag:
                    reply_payload["plan_ready"] = True
                if plan_meta:
                    reply_payload["plan_meta"] = plan_meta

                if not await _safe_send_json(websocket, reply_payload):
                    break

                if project_id is not None:
                    try:
                        assistant_metadata: dict[str, Any] = {}
                        assistant_metadata["execution_mode"] = execution_mode
                        if plan_ready_flag:
                            assistant_metadata["plan_ready"] = True
                        if plan_meta:
                            assistant_metadata["plan_meta"] = plan_meta
                        await append_chat_history(
                            project_id,
                            user_id or "",
                            "assistant",
                            assistant_message,
                            metadata=assistant_metadata or None,
                        )
                    except Exception:
                        pass
            except GraphMutationApplyError as error:
                assistant_message = _format_mutation_failure_message(error)
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                    },
                ):
                    break
                if project_id is not None:
                    try:
                        await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                    except Exception:
                        pass
            except RuntimeError as error:
                if mutation_intent:
                    assistant_message = _format_mutation_failure_message(error)
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "chat_reply_done",
                            "project_id": project_id,
                            "message": assistant_message,
                            "execution_mode": execution_mode,
                        },
                    ):
                        break
                    if project_id is not None:
                        try:
                            await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                        except Exception:
                            pass
                    continue
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "chat_failed",
                        "message": str(error),
                    },
                ):
                    break
            except Exception as error:
                if mutation_intent:
                    assistant_message = _format_mutation_failure_message(error)
                    if not await _safe_send_json(
                        websocket,
                        {
                            "type": "chat_reply_done",
                            "project_id": project_id,
                            "message": assistant_message,
                            "execution_mode": execution_mode,
                        },
                    ):
                        break
                    if project_id is not None:
                        try:
                            await append_chat_history(project_id, user_id or "", "assistant", assistant_message)
                        except Exception:
                            pass
                    continue
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "chat_failed",
                        "message": str(error),
                    },
                ):
                    break

        elif msg_type == "chat_plan_approve":
            project_id = _project_id_from_message(data)
            plan_id = data.get("plan_id")
            requested_change_override = data.get("requested_change")

            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for chat_plan_approve.",
                    },
                ):
                    break
                continue

            if not isinstance(plan_id, str) or not plan_id.strip():
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_plan_id",
                        "message": "plan_id is required for chat_plan_approve.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            prior_history = project_row.get("chat_history") if isinstance(project_row.get("chat_history"), list) else []
            trimmed_plan_id = plan_id.strip()
            pending_plan = _find_pending_architecture_plan(prior_history, plan_id=trimmed_plan_id)
            override_change = (
                requested_change_override.strip()
                if isinstance(requested_change_override, str) and requested_change_override.strip()
                else None
            )

            approved_plan_id = trimmed_plan_id
            approved_prompt: str | None = None
            if pending_plan is not None:
                pending_plan_id = pending_plan.get("plan_id")
                if isinstance(pending_plan_id, str) and pending_plan_id.strip():
                    approved_plan_id = pending_plan_id
                requested_change = pending_plan.get("requested_change")
                approved_prompt = (
                    requested_change
                    if isinstance(requested_change, str) and requested_change.strip()
                    else "approved architecture refactor"
                )
            elif override_change:
                approved_prompt = override_change
            else:
                assistant_message = "I couldn't find an active architecture plan to approve. Please ask for a new plan first."
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": "architecture_refactor",
                    },
                ):
                    break
                try:
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "assistant",
                        assistant_message,
                        metadata={"execution_mode": "architecture_refactor"},
                    )
                except Exception:
                    pass
                continue

            rerun_answers = _build_full_rerun_answers(project_row, approved_prompt, prior_history)

            try:
                client_ip = _client_ip_from_websocket(websocket)
                rerun_result = await start_generation_for_user(
                    user_id or "",
                    user_email or "",
                    rerun_answers,
                    project_id,
                    client_ip=client_ip,
                )
                trace_id = rerun_result.get("trace_id")
                trace_suffix = f" (trace {trace_id})" if isinstance(trace_id, str) and trace_id else ""
                assistant_message = (
                    "Plan approved. I'm generating the updated architecture now and will stream the refreshed diagram and pricing"
                    f"{trace_suffix}."
                )
                status = "approved"
            except GenerationStartError as error:
                assistant_message = (
                    "I couldn't start the approved architecture update yet. "
                    f"{error.message}"
                )
                status = "pending"

            approved_plan_meta = {
                "plan_id": approved_plan_id,
                "type": "architecture_refactor",
                "status": status,
                "requested_change": approved_prompt,
            }
            if not await _safe_send_json(
                websocket,
                {
                    "type": "chat_reply_done",
                    "project_id": project_id,
                    "message": assistant_message,
                    "execution_mode": "architecture_refactor",
                    "plan_meta": approved_plan_meta,
                },
            ):
                break
            try:
                await append_chat_history(
                    project_id,
                    user_id or "",
                    "assistant",
                    assistant_message,
                    metadata={
                        "execution_mode": "architecture_refactor",
                        "plan_meta": approved_plan_meta,
                    },
                )
            except Exception:
                pass

        elif msg_type == "canvas_edit":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for canvas_edit.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            action = data.get("action", "")
            nodes: list[dict[str, Any]] = list(project_row.get("nodes") or [])
            edges: list[dict[str, Any]] = list(project_row.get("edges") or [])

            edit_result = _apply_canvas_edit(action, nodes, edges, data)
            if edit_result is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "unknown_canvas_action",
                        "message": f"Unknown canvas_edit action: {action!r}",
                    },
                ):
                    break
                continue

            updated_nodes, updated_edges = edit_result
            try:
                await update_project_fields(
                    project_id,
                    user_id or "",
                    {
                        "nodes": updated_nodes,
                        "edges": updated_edges,
                        **(
                            {"setup_pdf_status": "outdated"}
                            if project_row.get("setup_pdf_status") in {"ready", "outdated"}
                            else {}
                        ),
                    },
                )
            except Exception as error:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "canvas_edit_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

            if action == "add_node":
                questionnaire_answers = project_row.get("questionnaire_answers")
                region_source = questionnaire_answers if isinstance(questionnaire_answers, dict) else {}
                budget_source = questionnaire_answers if isinstance(questionnaire_answers, dict) else {}
                try:
                    cost_estimate = await run_cost_analyst(
                        nodes=updated_nodes,
                        regions=_normalize_regions(region_source),
                        project_id=project_id,
                        runtime=SimpleNamespace(client_ip=_client_ip_from_websocket(websocket)),
                        monthly_budget=budget_source.get("monthly_budget"),
                        budget_cap=budget_source.get("budget_cap"),
                    )
                except Exception:
                    logger.exception("canvas_edit_cost_estimate_failed project_id=%s", project_id)
                    cost_estimate = None

                if isinstance(cost_estimate, dict):
                    try:
                        await update_project_fields(
                            project_id,
                            user_id or "",
                            {"cost_estimate": cost_estimate},
                        )
                        await broadcast_project_event(
                            project_id,
                            {"type": "cost_estimate", **cost_estimate},
                        )
                    except Exception:
                        logger.exception("canvas_edit_cost_persist_failed project_id=%s", project_id)

            ack_payload: dict[str, Any] = {
                "type": "canvas_edit_ack",
                "project_id": project_id,
                "action": action,
            }
            if isinstance(data.get("id"), str) and data.get("id").strip():
                ack_payload["node_id"] = data.get("id").strip()

            if not await _safe_send_json(
                websocket,
                ack_payload,
            ):
                break

        elif msg_type == "generate_terraform":
            project_id = _project_id_from_message(data)
            if project_id is None:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_project_id",
                        "message": "project_id is required for generate_terraform.",
                    },
                ):
                    break
                continue

            try:
                project_row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "project_not_found",
                        "message": "Project not found.",
                    },
                ):
                    break
                continue

            node_count = len(project_row.get("nodes") or [])
            if node_count == 0:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "no_diagram_nodes",
                        "message": "Cannot generate Terraform: no nodes on canvas. Design your architecture first.",
                    },
                ):
                    break
                continue

            tf_trace_id = str(uuid4())
            logger.info(
                "generate_terraform.start trace_id=%s project_id=%s user_id=%s node_count=%d",
                tf_trace_id,
                project_id,
                user_id,
                node_count,
            )

            await subscribe_websocket(project_id, websocket)
            subscribed_projects.add(project_id)

            try:
                rerun_result = await rerun_project_agents_for_user(
                    user_id=user_id or "",
                    user_email=user_email or "",
                    project_id=project_id,
                    agent_names=["coder"],
                )
                rerun_trace = rerun_result.get("trace_id")
                logger.info(
                    "generate_terraform.queued trace_id=%s project_id=%s rerun_trace=%s",
                    tf_trace_id,
                    project_id,
                    rerun_trace,
                )
            except GenerationStartError as error:
                logger.error(
                    "generate_terraform.failed trace_id=%s project_id=%s error=%s",
                    tf_trace_id,
                    project_id,
                    error.message,
                )
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": error.code,
                        "message": error.message,
                    },
                ):
                    break
                continue
            except Exception as error:
                logger.error(
                    "generate_terraform.failed trace_id=%s project_id=%s error=%s",
                    tf_trace_id,
                    project_id,
                    str(error),
                    exc_info=True,
                )
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "terraform_generation_failed",
                        "message": str(error),
                    },
                ):
                    break
                continue

        else:
            if not await _safe_send_json(
                websocket,
                {"type": "error", "error": f"unknown message type: {msg_type}"},
            ):
                break

    for project_id in list(subscribed_projects):
        await unsubscribe_websocket(project_id, websocket)
    await unsubscribe_websocket_from_all(websocket)
    logger.info("ws.cleanup_complete client=%s:%s", client_host, client_port)
