import json
import logging
import os
import re
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from auth import verify_access_token_user
from rate_limiter import RateLimiter
from agents.cost_analyst import run_cost_analyst
from agents.chat_agent import extract_mutation_constraints, is_mutation_intent, stream_chat_reply
from agents.mutation_agent import run_mutation_agent
from agents.mutation_apply import GraphMutationApplyError, apply_graph_mutation
from generation_service import (
    broadcast_project_event,
    GenerationStartError,
    append_chat_history,
    get_generation_observability,
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


def _sanitize_graph_payload(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_nodes = data.get("nodes")
    raw_edges = data.get("edges")
    nodes = [node for node in raw_nodes if isinstance(node, dict)] if isinstance(raw_nodes, list) else []
    edges = [edge for edge in raw_edges if isinstance(edge, dict)] if isinstance(raw_edges, list) else []
    return nodes, edges


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
    terraform_time = row.get("terraform_generated_at")
    arch_time = row.get("architecture_modified_at")

    terraform_outdated = False
    if arch_time and terraform_time:
        terraform_outdated = arch_time > terraform_time
    elif arch_time and not terraform_time:
        terraform_outdated = True

    setup_pdf_outdated = row.get("setup_pdf_status") == "outdated"

    project_id = row.get("id")
    generation_agents = None
    if isinstance(project_id, str):
        generation_agents = get_generation_observability(project_id)

    snapshot_payload: dict[str, Any] = {
        "type": "generation_snapshot",
        "project_id": project_id,
        "project_mode": row.get("project_mode"),
        "nodes": row.get("nodes") if isinstance(row.get("nodes"), list) else [],
        "edges": row.get("edges") if isinstance(row.get("edges"), list) else [],
        "terraform_files": row.get("terraform_files") if isinstance(row.get("terraform_files"), list) else [],
        "cost_estimate": row.get("cost_estimate") if isinstance(row.get("cost_estimate"), dict) else None,
        "chat_history": row.get("chat_history") if isinstance(row.get("chat_history"), list) else [],
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
        "terraform_outdated": terraform_outdated,
        "setup_pdf_outdated": setup_pdf_outdated,
        "terraform_generated_at": terraform_time,
        "architecture_modified_at": arch_time,
    }

    if generation_agents is not None:
        snapshot_payload["generation_agents"] = generation_agents

    return await _safe_send_json(websocket, snapshot_payload)


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
        pending = {node_id}
        removed = set[str]()
        while pending:
            current = pending.pop()
            if not isinstance(current, str) or current in removed:
                continue
            removed.add(current)
            for node in nodes:
                if node.get("parentId") == current and isinstance(node.get("id"), str):
                    pending.add(node["id"])

        updated_nodes = [n for n in nodes if n.get("id") not in removed]
        updated_edges = [
            e for e in edges
            if e.get("source") not in removed and e.get("target") not in removed
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


def _summarize_plan_diff(diff: Any) -> str:
    if not isinstance(diff, dict):
        return ""

    add_nodes = diff.get("add_nodes") if isinstance(diff.get("add_nodes"), list) else []
    edit_nodes = diff.get("edit_nodes") if isinstance(diff.get("edit_nodes"), list) else []
    delete_node_ids = diff.get("delete_node_ids") if isinstance(diff.get("delete_node_ids"), list) else []
    add_edges = diff.get("add_edges") if isinstance(diff.get("add_edges"), list) else []
    delete_edge_ids = diff.get("delete_edge_ids") if isinstance(diff.get("delete_edge_ids"), list) else []

    parts: list[str] = []
    if add_nodes:
        labels = [entry.get("label") for entry in add_nodes if isinstance(entry, dict) and isinstance(entry.get("label"), str)]
        if labels:
            parts.append(f"add {', '.join(labels[:3])}")
        else:
            parts.append(f"add {len(add_nodes)} node(s)")
    if edit_nodes:
        parts.append(f"edit {len(edit_nodes)} node(s)")
    if delete_node_ids:
        parts.append(f"remove {len(delete_node_ids)} node(s)")
    if add_edges:
        parts.append(f"add {len(add_edges)} connection(s)")
    if delete_edge_ids:
        parts.append(f"remove {len(delete_edge_ids)} connection(s)")
    if not parts:
        return ""
    return "Plan: " + "; ".join(parts) + "."


def _sanitize_plan_message(message: str, diff: Any) -> str:
    normalized = message.strip()
    if not normalized:
        normalized = "I prepared a safe architecture change plan."

    forbidden_phrases = (
        "refresh terraform outputs",
        "re-running coder",
        "rerunning coder",
        "run the coder",
        "generate terraform for you now",
        "applying update",
    )
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    cleaned_lines: list[str] = []
    for line in lines:
        lowered = line.lower()
        if any(phrase in lowered for phrase in forbidden_phrases):
            continue
        cleaned_lines.append(line)

    cleaned = "\n".join(cleaned_lines).strip()
    if not cleaned:
        cleaned = "I prepared a safe architecture change plan."

    lowered = cleaned.lower()
    if "plan:" not in lowered:
        diff_summary = _summarize_plan_diff(diff)
        if diff_summary:
            cleaned = f"{cleaned}\n\n{diff_summary}"

    return cleaned


def _ensure_plan_approval_copy(message: str, diff: Any) -> str:
    normalized = _sanitize_plan_message(message, diff)

    lowered = normalized.lower()
    if "implement plan" in lowered or "approve" in lowered:
        return normalized

    return (
        f"{normalized}\n\n"
        "Review this plan, then click Implement plan to apply it. "
        "Terraform files will be marked outdated until you generate them again."
    )


def _format_mutation_plan_details(mutation_plan: Any) -> str:
    """Format mutation plan into human-readable summary for plan preview."""
    parts = []

    diff = mutation_plan.diff
    diff_dict = diff.model_dump() if hasattr(diff, "model_dump") else diff.__dict__ if hasattr(diff, "__dict__") else dict(diff)

    nodes_added = diff_dict.get("add_nodes", [])
    nodes_edited = diff_dict.get("edit_nodes", [])
    nodes_deleted = diff_dict.get("delete_node_ids", [])
    edges_added = diff_dict.get("add_edges", [])
    edges_deleted = diff_dict.get("delete_edge_ids", [])

    if nodes_added:
        node_names = [n.get("label") or n.get("id", "unknown") for n in nodes_added if isinstance(n, dict)]
        parts.append(f"**Add {len(nodes_added)} node(s):** {', '.join(node_names)}")

    if nodes_edited:
        node_names = [n.get("label") or n.get("id", "unknown") for n in nodes_edited if isinstance(n, dict)]
        parts.append(f"**Edit {len(nodes_edited)} node(s):** {', '.join(node_names)}")

    if nodes_deleted:
        node_names = [str(n) for n in nodes_deleted]
        parts.append(f"**Delete {len(nodes_deleted)} node(s):** {', '.join(node_names)}")

    if edges_added:
        edge_labels = [e.get("label") or f"{e.get('source', '?')} -> {e.get('target', '?')}" for e in edges_added if isinstance(e, dict)]
        parts.append(f"**Add {len(edges_added)} connection(s):** {', '.join(edge_labels)}")

    if edges_deleted:
        edge_labels = [str(e) for e in edges_deleted]
        parts.append(f"**Remove {len(edges_deleted)} connection(s):** {', '.join(edge_labels)}")

    reasoning = getattr(mutation_plan, "reasoning", "") or ""
    if reasoning:
        parts.append(f"\n**Why:** {reasoning}")

    return "\n".join(parts) if parts else "No changes planned."


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


def _to_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _find_pending_chat_plan(
    history: list[dict[str, Any]],
    plan_id: str | None = None,
) -> dict[str, Any] | None:
    terminal_states = {"approved", "executed", "rejected", "cancelled"}
    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue
        plan_meta = entry.get("plan_meta")
        if not isinstance(plan_meta, dict):
            continue
        plan_type = plan_meta.get("type")
        if plan_type not in {"architecture_refactor", "node_patch", "plan_only"}:
            continue
        candidate_id = plan_meta.get("plan_id")
        if plan_id and candidate_id != plan_id:
            continue
        status = plan_meta.get("status")
        if status in terminal_states:
            return None
        if status == "pending":
            return plan_meta
    return None


_BUDGET_RECOVERY_COMMAND_PATTERN = re.compile(r"^\s*(accept|retry)\s*[.!?]?\s*$", re.IGNORECASE)
_BUDGET_RECOVERY_TERMINAL_STATES = {"accepted", "retry_started", "resolved", "cancelled"}


def _extract_budget_recovery_command(message: str) -> str | None:
    match = _BUDGET_RECOVERY_COMMAND_PATTERN.match(message)
    if not match:
        return None
    return match.group(1).lower()


def _normalize_budget_recovery_entry(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    status = payload.get("status")
    if not isinstance(status, str) or not status.strip():
        return None

    normalized: dict[str, Any] = {"status": status.strip().lower()}
    for key in ("budget_cap", "estimated_total", "overage"):
        parsed = _to_number(payload.get(key))
        if parsed is not None:
            normalized[key] = round(parsed, 2)
    trace_id = payload.get("trace_id")
    if isinstance(trace_id, str) and trace_id.strip():
        normalized["trace_id"] = trace_id.strip()
    requirements = payload.get("requirements")
    if isinstance(requirements, dict):
        normalized["requirements"] = requirements
    return normalized


def _find_pending_budget_recovery(history: list[dict[str, Any]]) -> dict[str, Any] | None:
    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue
        normalized = _normalize_budget_recovery_entry(entry.get("budget_recovery"))
        if not normalized:
            continue
        status = normalized.get("status")
        if status in _BUDGET_RECOVERY_TERMINAL_STATES:
            return None
        if status == "pending":
            return normalized
    return None


def _format_usd(value: Any) -> str | None:
    number = _to_number(value)
    if number is None:
        return None
    return f"${number:,.2f}"


def _build_budget_accept_message(context: dict[str, Any]) -> str:
    budget_cap = _format_usd(context.get("budget_cap"))
    estimated_total = _format_usd(context.get("estimated_total"))
    overage = _format_usd(context.get("overage"))
    if budget_cap and estimated_total and overage:
        return (
            f"Accepted. I'll keep this architecture at about {estimated_total}/mo, "
            f"which is {overage} above your {budget_cap} budget."
        )
    return "Accepted. I'll keep this architecture as-is and continue from the current design."


def _build_budget_retry_message(context: dict[str, Any], trace_id: str | None) -> str:
    budget_cap = _format_usd(context.get("budget_cap"))
    estimated_total = _format_usd(context.get("estimated_total"))
    trace_suffix = f" (trace {trace_id})" if isinstance(trace_id, str) and trace_id else ""
    if budget_cap and estimated_total:
        return (
            f"Retrying now with tighter budget constraints{trace_suffix}. "
            f"Current estimate is {estimated_total}/mo against a {budget_cap} budget cap."
        )
    return f"Retrying now with tighter budget constraints{trace_suffix}."


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


def _build_budget_retry_answers(
    project_row: dict[str, Any],
    user_message: str,
    prior_history: list[dict[str, Any]],
    budget_recovery_context: dict[str, Any],
) -> dict[str, Any]:
    answers = _build_full_rerun_answers(project_row, user_message, prior_history)
    budget_cap = _to_number(budget_recovery_context.get("budget_cap"))
    estimated_total = _to_number(budget_recovery_context.get("estimated_total"))
    requirements = budget_recovery_context.get("requirements")

    if budget_cap is None or estimated_total is None:
        raise ValueError("Budget retry context is missing numeric budget details.")
    if not isinstance(requirements, dict) or not requirements:
        raise ValueError("Budget retry context is missing requirements snapshot.")

    answers["_budget_recovery_retry"] = True
    answers["_budget_recovery_context"] = {
        "budget_cap": round(budget_cap, 2),
        "estimated_total": round(estimated_total, 2),
        "requirements": requirements,
    }
    return answers


async def handle_websocket(websocket: WebSocket, rate_limiter: RateLimiter | None = None, client_ip: str = "unknown") -> None:
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
      - generation_agent_update: { type, project_id, trace_id, mode, agents[] }
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

    user_id: str | None = None
    user_email: str | None = None
    user_tracked = False

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
        if not isinstance(msg_type, str) or not msg_type.strip():
            if not await _safe_send_json(websocket, {"type": "error", "error": "invalid_message_type", "message": "Message type must be a non-empty string."}):
                break
            continue
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
            "estimate_cost",
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

            if rate_limiter is not None and not user_tracked and user_id is not None:
                if not rate_limiter.track_ws_user(
                    client_ip,
                    user_id,
                    websocket,
                    max_user_connections=int(os.getenv("RATE_LIMIT_WS_PER_USER", "5")),
                ):
                    await _safe_send_json(
                        websocket,
                        {"type": "error", "error": "rate_limit_exceeded", "message": "Too many connections for this user."},
                    )
                    await websocket.close(code=1008)
                    return
                user_tracked = True

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

            await subscribe_websocket(project_id, websocket)

            try:
                row = await get_project_for_user(project_id, user_id or "")
            except Exception:
                await unsubscribe_websocket(project_id, websocket)
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

            subscribed_projects.add(project_id)

            if not await _send_generation_snapshot(websocket, row):
                break

        elif msg_type == "chat":
            project_id = _project_id_from_message(data)
            chat_text = data.get("message")
            incoming_nodes, incoming_edges = _sanitize_graph_payload(data)
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
                project_row = {
                    "id": None,
                    "nodes": incoming_nodes,
                    "edges": incoming_edges,
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

                if (
                    isinstance(project_row.get("nodes"), list)
                    and len(project_row.get("nodes") or []) == 0
                    and incoming_nodes
                ):
                    project_row = {
                        **project_row,
                        "nodes": incoming_nodes,
                        "edges": incoming_edges,
                    }
                    logger.warning(
                        "chat.context_fallback project_id=%s user_id=%s fallback_nodes=%d",
                        project_id,
                        user_id,
                        len(incoming_nodes),
                    )
                    try:
                        await update_project_fields(
                            project_id,
                            user_id or "",
                            {"nodes": incoming_nodes, "edges": incoming_edges},
                        )
                    except Exception:
                        logger.exception("chat.context_fallback_persist_failed project_id=%s", project_id)

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

            pending_budget_recovery = _find_pending_budget_recovery(prior_history)
            budget_recovery_command = _extract_budget_recovery_command(user_message)
            if project_id is not None and pending_budget_recovery and budget_recovery_command in {"accept", "retry"}:
                execution_mode = "chat_only"
                budget_recovery_payload = dict(pending_budget_recovery)

                if budget_recovery_command == "accept":
                    budget_recovery_payload["status"] = "accepted"
                    assistant_message = _build_budget_accept_message(budget_recovery_payload)
                    try:
                        await update_project_fields(
                            project_id,
                            user_id or "",
                            {
                                "generation_status": "completed",
                                "generation_stage": "completed",
                                "generation_error": None,
                            },
                        )
                    except Exception:
                        logger.exception(
                            "budget_recovery.accept_state_update_failed project_id=%s user_id=%s",
                            project_id,
                            user_id,
                        )
                else:
                    retry_trace: str | None = None
                    try:
                        client_ip = _client_ip_from_websocket(websocket)
                        rerun_answers = _build_budget_retry_answers(
                            project_row,
                            user_message,
                            prior_history,
                            budget_recovery_payload,
                        )
                        rerun_result = await start_generation_for_user(
                            user_id or "",
                            user_email or "",
                            rerun_answers,
                            project_id,
                            client_ip=client_ip,
                        )
                        trace_candidate = rerun_result.get("trace_id")
                        if isinstance(trace_candidate, str) and trace_candidate.strip():
                            retry_trace = trace_candidate.strip()
                        budget_recovery_payload["status"] = "retry_started"
                        if retry_trace:
                            budget_recovery_payload["trace_id"] = retry_trace
                        assistant_message = _build_budget_retry_message(budget_recovery_payload, retry_trace)
                    except GenerationStartError as error:
                        budget_recovery_payload["status"] = "pending"
                        assistant_message = (
                            "I couldn't start the tighter budget retry yet. "
                            f"{error.message}"
                        )
                    except Exception as error:
                        budget_recovery_payload["status"] = "pending"
                        assistant_message = (
                            "I couldn't start the tighter budget retry yet. "
                            f"{str(error).strip() or 'Please try again.'}"
                        )

                reply_payload: dict[str, Any] = {
                    "type": "chat_reply_done",
                    "project_id": project_id,
                    "message": assistant_message,
                    "execution_mode": execution_mode,
                    "budget_recovery": budget_recovery_payload,
                }
                if not await _safe_send_json(websocket, reply_payload):
                    break

                try:
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "assistant",
                        assistant_message,
                        metadata={
                            "execution_mode": execution_mode,
                            "budget_recovery": budget_recovery_payload,
                        },
                    )
                except Exception:
                    pass
                continue

            assistant_chunks: list[str] = []
            plan_ready_flag = False
            plan_meta: dict[str, Any] | None = None
            execution_mode = "chat_only"
            mutation_intent = False
            try:
                execution_mode = _classify_execution_mode(user_message, selected_node_ids)
                if is_projectless_chat and execution_mode in ("node_patch", "architecture_refactor", "plan_only"):
                    # Projectless sessions cannot mutate persisted state.
                    execution_mode = "chat_only"

                if execution_mode in ("architecture_refactor", "node_patch", "plan_only"):
                    mutation_intent = True
                    include_warning = _contains_explicit_insecure_secrets_request(user_message)
                    mutation_constraints = extract_mutation_constraints(user_message, selected_node_ids)

                    mutation_plan = await run_mutation_agent(
                        user_goal=user_message,
                        project_state=project_row,
                        selected_node_ids=selected_node_ids,
                        history=prior_history,
                        llm_creds=llm_creds,
                        user_constraints=mutation_constraints,
                    )

                    assistant_message = mutation_plan.assistant_message
                    if include_warning:
                        assistant_message = (
                            "Security warning: this request may weaken secret-management protections.\n\n"
                            f"{assistant_message}"
                        )
                    assistant_message = _ensure_plan_approval_copy(
                        assistant_message,
                        mutation_plan.diff.model_dump(mode="python"),
                    )

                    plan_details = _format_mutation_plan_details(mutation_plan)
                    plan_meta = {
                        "plan_id": str(uuid4()),
                        "type": execution_mode,
                        "status": "pending",
                        "requested_change": user_message,
                        "selected_node_ids": selected_node_ids,
                        "cached_plan": mutation_plan.model_dump(mode="python"),
                        "mutation_plan": mutation_plan.model_dump() if hasattr(mutation_plan, "model_dump") else {"assistant_message": mutation_plan.assistant_message, "reasoning": mutation_plan.reasoning, "diff": mutation_plan.diff.model_dump() if hasattr(mutation_plan.diff, "model_dump") else dict(mutation_plan.diff)},
                        "details": {
                            "nodes_added": [
                                {
                                    "id": (n.model_dump() if hasattr(n, "model_dump") else n).get("id"),
                                    "label": (n.model_dump() if hasattr(n, "model_dump") else n).get("label") or (n.model_dump() if hasattr(n, "model_dump") else n).get("id"),
                                    "category": (n.model_dump() if hasattr(n, "model_dump") else n).get("category"),
                                }
                                for n in (mutation_plan.diff.add_nodes or [])
                                if isinstance((n.model_dump() if hasattr(n, "model_dump") else n), dict)
                            ],
                            "nodes_edited": [
                                {
                                    "id": (n.model_dump() if hasattr(n, "model_dump") else n).get("id"),
                                    "label": (n.model_dump() if hasattr(n, "model_dump") else n).get("label") or (n.model_dump() if hasattr(n, "model_dump") else n).get("id"),
                                    "category": (n.model_dump() if hasattr(n, "model_dump") else n).get("category"),
                                }
                                for n in (mutation_plan.diff.edit_nodes or [])
                                if isinstance((n.model_dump() if hasattr(n, "model_dump") else n), dict)
                            ],
                            "nodes_deleted": [
                                {"id": node_id, "label": node_id}
                                for node_id in (mutation_plan.diff.delete_node_ids or [])
                                if isinstance(node_id, str)
                            ],
                            "edges_added": [
                                {
                                    "from": edge.get("source"),
                                    "to": edge.get("target"),
                                    "label": edge.get("label") or "",
                                }
                                for edge in [e.model_dump() if hasattr(e, "model_dump") else e for e in (mutation_plan.diff.add_edges or [])]
                                if isinstance(edge, dict)
                            ],
                            "edges_deleted": [
                                {"from": edge_id, "to": edge_id, "label": edge_id}
                                for edge_id in (mutation_plan.diff.delete_edge_ids or [])
                                if isinstance(edge_id, str)
                            ],
                            "reasoning": mutation_plan.reasoning,
                        },
                    }
                    plan_ready_flag = True

                    assistant_message = (
                        f"{assistant_message}\n\n"
                        f"{plan_details}\n\n"
                        "Click \"Apply this change\" to proceed, or modify your request."
                    )

                    reply_payload: dict[str, Any] = {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": execution_mode,
                        "plan_ready": True,
                        "plan_meta": plan_meta,
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
                                metadata={
                                    "execution_mode": execution_mode,
                                    "plan_ready": True,
                                    "plan_meta": plan_meta,
                                },
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
            pending_plan = _find_pending_chat_plan(prior_history, plan_id=trimmed_plan_id)
            override_change = (
                requested_change_override.strip()
                if isinstance(requested_change_override, str) and requested_change_override.strip()
                else None
            )

            approved_plan_id = trimmed_plan_id
            approved_prompt: str | None = None
            approved_plan_type = "architecture_refactor"
            approved_selected_node_ids: list[str] = []
            if pending_plan is not None:
                pending_plan_id = pending_plan.get("plan_id")
                if isinstance(pending_plan_id, str) and pending_plan_id.strip():
                    approved_plan_id = pending_plan_id
                pending_type = pending_plan.get("type")
                if pending_type in {"architecture_refactor", "node_patch", "plan_only"}:
                    approved_plan_type = pending_type
                requested_change = pending_plan.get("requested_change")
                if isinstance(requested_change, str) and requested_change.strip():
                    approved_prompt = requested_change
                raw_selected_node_ids = pending_plan.get("selected_node_ids")
                if isinstance(raw_selected_node_ids, list):
                    approved_selected_node_ids = [
                        entry.strip()
                        for entry in raw_selected_node_ids
                        if isinstance(entry, str) and entry.strip()
                    ]
            elif override_change:
                approved_prompt = override_change
            else:
                assistant_message = "I couldn't find an active chat plan to approve. Please ask for a new plan first."
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "chat_reply_done",
                        "project_id": project_id,
                        "message": assistant_message,
                        "execution_mode": approved_plan_type,
                    },
                ):
                    break
                try:
                    await append_chat_history(
                        project_id,
                        user_id or "",
                        "assistant",
                        assistant_message,
                        metadata={"execution_mode": approved_plan_type},
                    )
                except Exception:
                    pass
                continue

            if not approved_prompt:
                approved_prompt = f"approved {approved_plan_type}"

            execution_mode = approved_plan_type
            assistant_message = ""
            status = "approved"
            mutation_payload: dict[str, Any] | None = None

            try:
                cached_plan_dict = (
                    pending_plan.get("cached_plan")
                    if isinstance(pending_plan, dict)
                    else None
                )
                mutation_plan_dict = (
                    pending_plan.get("mutation_plan")
                    if isinstance(pending_plan, dict)
                    else None
                )

                if isinstance(cached_plan_dict, dict) and cached_plan_dict:
                    from agents.mutation_schema import MutationPlan
                    mutation_plan = MutationPlan.model_validate(cached_plan_dict)
                elif mutation_plan_dict:
                    from agents.mutation_schema import MutationPlan
                    mutation_plan = MutationPlan.model_validate(mutation_plan_dict)
                else:
                    mutation_constraints = extract_mutation_constraints(approved_prompt, approved_selected_node_ids)
                    mutation_plan = await run_mutation_agent(
                        user_goal=approved_prompt,
                        project_state=project_row,
                        selected_node_ids=approved_selected_node_ids,
                        history=prior_history,
                        llm_creds=None,
                        user_constraints=mutation_constraints,
                    )

                applied = apply_graph_mutation(
                    nodes=list(project_row.get("nodes") or []),
                    edges=list(project_row.get("edges") or []),
                    diff=mutation_plan.diff,
                    selected_node_ids=approved_selected_node_ids if approved_selected_node_ids else None,
                )

                from datetime import datetime, timezone

                await update_project_fields(
                    project_id,
                    user_id or "",
                    {
                        "nodes": applied["nodes"],
                        "edges": applied["edges"],
                        "architecture_modified_at": datetime.now(timezone.utc).isoformat(),
                        "terraform_files": [],
                        "cost_estimate": None,
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
                if _contains_explicit_insecure_secrets_request(approved_prompt):
                    assistant_message = (
                        "Security warning: this change may weaken secret handling. "
                        "I applied the request as asked; consider IAM roles + KMS as a safer default.\n\n"
                        f"{assistant_message}"
                    )

                mutation_payload = {
                    "diff": applied["normalized_diff"],
                    "summary": applied["summary"],
                    "scope": _mutation_scope(approved_selected_node_ids),
                }

                questionnaire_answers = project_row.get("questionnaire_answers")
                region_source = questionnaire_answers if isinstance(questionnaire_answers, dict) else {}
                budget_source = questionnaire_answers if isinstance(questionnaire_answers, dict) else {}
                try:
                    cost_estimate = await run_cost_analyst(
                        nodes=applied["nodes"],
                        regions=_normalize_regions(region_source),
                        project_id=project_id,
                        runtime=SimpleNamespace(client_ip=_client_ip_from_websocket(websocket)),
                        monthly_budget=budget_source.get("monthly_budget"),
                        budget_cap=budget_source.get("budget_cap"),
                    )
                except Exception:
                    logger.exception("plan_approve_cost_estimate_failed project_id=%s", project_id)
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
                        logger.exception("plan_approve_cost_persist_failed project_id=%s", project_id)

                assistant_message = (
                    f"{assistant_message}\n\n"
                    "I've updated the canvas. Terraform files are now outdated; "
                    "click Generate Terraform when you're ready."
                )

            except GraphMutationApplyError as error:
                assistant_message = _format_mutation_failure_message(error)
                status = "pending"
            except Exception as error:
                assistant_message = _format_mutation_failure_message(error)
                status = "pending"

            approved_plan_meta = {
                "plan_id": approved_plan_id,
                "type": approved_plan_type,
                "status": status,
                "requested_change": approved_prompt,
            }
            if approved_selected_node_ids:
                approved_plan_meta["selected_node_ids"] = approved_selected_node_ids

            reply_payload: dict[str, Any] = {
                "type": "chat_reply_done",
                "project_id": project_id,
                "message": assistant_message,
                "execution_mode": execution_mode,
                "plan_meta": approved_plan_meta,
            }
            if mutation_payload is not None:
                reply_payload["mutation"] = mutation_payload
            if not await _safe_send_json(
                websocket,
                reply_payload,
            ):
                break
            try:
                await append_chat_history(
                    project_id,
                    user_id or "",
                    "assistant",
                    assistant_message,
                    metadata={
                        "execution_mode": execution_mode,
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
            incoming_nodes, incoming_edges = _sanitize_graph_payload(data)
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

            persisted_nodes = project_row.get("nodes") if isinstance(project_row.get("nodes"), list) else []
            node_count = len(persisted_nodes)
            if node_count == 0 and incoming_nodes:
                node_count = len(incoming_nodes)
                logger.warning(
                    "generate_terraform.context_fallback project_id=%s user_id=%s fallback_nodes=%d",
                    project_id,
                    user_id,
                    node_count,
                )
                try:
                    await update_project_fields(
                        project_id,
                        user_id or "",
                        {"nodes": incoming_nodes, "edges": incoming_edges},
                    )
                except Exception:
                    logger.exception("generate_terraform.context_fallback_persist_failed project_id=%s", project_id)

            if node_count == 0:
                logger.warning(
                    "generate_terraform.no_diagram_nodes project_id=%s user_id=%s",
                    project_id,
                    user_id,
                )
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

        elif msg_type == "estimate_cost":
            raw_nodes = data.get("nodes")
            if not isinstance(raw_nodes, list) or len(raw_nodes) == 0:
                if not await _safe_send_json(
                    websocket,
                    {
                        "type": "error",
                        "error": "missing_nodes",
                        "message": "estimate_cost requires a non-empty nodes array.",
                    },
                ):
                    break
                continue

            try:
                cost_estimate = await run_cost_analyst(
                    nodes=raw_nodes,
                    regions=[],
                    project_id="",
                    runtime=SimpleNamespace(client_ip=_client_ip_from_websocket(websocket)),
                )
            except Exception:
                logger.exception("estimate_cost_failed user_id=%s", user_id)
                cost_estimate = None

            if isinstance(cost_estimate, dict):
                response_payload = {"type": "cost_estimate", **cost_estimate}
                request_id = data.get("request_id")
                if isinstance(request_id, str) and request_id.strip():
                    response_payload["request_id"] = request_id.strip()
                if not await _safe_send_json(
                    websocket,
                    response_payload,
                ):
                    break

        else:
            if not await _safe_send_json(
                websocket,
                {"type": "error", "error": f"unknown message type: {msg_type}"},
            ):
                break

    for project_id in list(subscribed_projects):
        await unsubscribe_websocket(project_id, websocket)
    await unsubscribe_websocket_from_all(websocket)
    if rate_limiter is not None:
        rate_limiter.remove_ws_connection(client_ip, user_id, websocket)
    logger.info("ws.cleanup_complete client=%s:%s", client_host, client_port)
