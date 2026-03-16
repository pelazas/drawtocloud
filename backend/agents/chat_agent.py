import json
from typing import Any, AsyncGenerator

from llm_client import async_stream_text

MAX_CONTEXT_LINES = 25


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, indent=2, ensure_ascii=True)
    except (TypeError, ValueError):
        return "null"


def _summarize_nodes(nodes: Any) -> str:
    if not isinstance(nodes, list) or not nodes:
        return "No nodes available."

    lines: list[str] = []
    for node in nodes[:MAX_CONTEXT_LINES]:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id", "unknown"))
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        label = str(data.get("label", node_id))
        category = str(data.get("category", "unknown"))
        lines.append(f"- {label} (id={node_id}, category={category})")

    return "\n".join(lines) if lines else "No nodes available."


def _summarize_selection(nodes: Any, selected_ids: list[str]) -> str:
    if not selected_ids or not isinstance(nodes, list):
        return ""

    selected_lookup = {entry for entry in selected_ids if entry}
    if not selected_lookup:
        return ""

    lines: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id", "")).strip()
        if not node_id or node_id not in selected_lookup:
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        label = str(data.get("label", node_id))
        category = str(data.get("category", "unknown"))
        lines.append(f"- {label} (id={node_id}, category={category})")

    if not lines:
        return ""

    return (
        "\n\nSELECTED NODES (user is focused on these):\n"
        + "\n".join(lines)
        + "\n\nWhen the user says \"this\", \"these\", or \"selected\", they mean the nodes above. "
        "Scope your answer to these nodes unless broader context is clearly required."
    )


def _summarize_edges(edges: Any) -> str:
    if not isinstance(edges, list) or not edges:
        return "No edges available."

    lines: list[str] = []
    for edge in edges[:MAX_CONTEXT_LINES]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source", "unknown"))
        target = str(edge.get("target", "unknown"))
        label = str(edge.get("label", "")).strip()
        if label:
            lines.append(f"- {source} -> {target} ({label})")
        else:
            lines.append(f"- {source} -> {target}")

    return "\n".join(lines) if lines else "No edges available."


def _summarize_terraform(terraform_files: Any) -> str:
    if not isinstance(terraform_files, list) or not terraform_files:
        return "No Terraform files available."

    lines: list[str] = []
    for entry in terraform_files[:MAX_CONTEXT_LINES]:
        if not isinstance(entry, dict):
            continue
        filename = str(entry.get("filename", "unknown.tf"))
        content = entry.get("content")
        line_count = len(content.splitlines()) if isinstance(content, str) else 0
        lines.append(f"- {filename} ({line_count} lines)")

    return "\n".join(lines) if lines else "No Terraform files available."


def _summarize_cost(cost_estimate: Any) -> str:
    if not isinstance(cost_estimate, dict):
        return "No cost estimate available."

    lines: list[str] = []
    monthly_total = cost_estimate.get("monthly_total")
    currency = cost_estimate.get("currency", "USD")
    lines.append(f"- monthly_total: {monthly_total} {currency}")

    line_items = cost_estimate.get("line_items")
    if isinstance(line_items, list) and line_items:
        lines.append("- line_items:")
        for item in line_items[:MAX_CONTEXT_LINES]:
            if not isinstance(item, dict):
                continue
            service = str(item.get("service", "unknown"))
            resource = str(item.get("resource_type", "unknown"))
            cost = item.get("monthly_cost", "unknown")
            lines.append(f"  - {service} / {resource}: {cost} {currency}")

    return "\n".join(lines)


def _normalize_history(history: Any) -> list[dict[str, str]]:
    if not isinstance(history, list):
        return []

    messages: list[dict[str, str]] = []
    for entry in history:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    return messages


def build_chat_system_prompt(
    project_state: dict[str, Any],
    selected_node_ids: list[str] | None = None,
) -> str:
    description = project_state.get("description")
    description_text = _safe_json(description)
    if isinstance(description, str):
        description_text = description
    selected_context = _summarize_selection(project_state.get("nodes"), selected_node_ids or [])

    return f"""You are the DrawToCloud architecture assistant.

Read-only mode:
- You must NOT propose direct infrastructure mutations as if they have already happened.
- You can explain what exists, answer questions, and offer recommendations clearly marked as suggestions.
- If information is missing, say so and ask a concise follow-up question.

Current architecture context:
Nodes:
{_summarize_nodes(project_state.get("nodes"))}

Edges:
{_summarize_edges(project_state.get("edges"))}

Terraform summary:
{_summarize_terraform(project_state.get("terraform_files"))}

Cost breakdown:
{_summarize_cost(project_state.get("cost_estimate"))}

Architecture description:
{description_text}
{selected_context}

When answering:
- Be specific, concise, and reference the context above.
- If asked about HA/security/costs, ground claims in available nodes/edges/terraform/cost data.
"""


async def stream_chat_reply(
    question: str,
    history: list[dict[str, Any]],
    project_state: dict[str, Any],
    selected_node_ids: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    normalized_history = _normalize_history(history)
    messages = [*normalized_history, {"role": "user", "content": question}]
    system_prompt = build_chat_system_prompt(project_state, selected_node_ids=selected_node_ids)

    async for chunk in async_stream_text(messages=messages, system=system_prompt):
        if isinstance(chunk, str) and chunk:
            yield chunk
