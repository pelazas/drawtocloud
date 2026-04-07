import json
from typing import Any

from llm_client import async_complete

from agents.mutation_schema import MutationPlan

MUTATION_SYSTEM_PROMPT = """You are the DrawToCloud mutation planner.

Your job is to turn a user goal into a SAFE graph mutation plan.
You handle ALL types of architecture changes: cost reduction, compute migration,
adding/removing services, security hardening, reliability improvements, and
architecture simplification.

Return ONLY valid JSON in this exact schema:
{
  "assistant_message": "User-facing summary of what will change and why. Include specific numbers for cost savings or trade-offs when cost data is available.",
  "reasoning": "Internal concise reasoning used for the change",
  "constraints_respected": ["constraint 1", "constraint 2"],
  "diff": {
    "add_nodes": [
      {"id": "optional_id", "label": "Node Label", "category": "compute", "type": "service", "parent_id": "optional_parent"}
    ],
    "edit_nodes": [
      {"id": "node_id", "label": "optional new label", "category": "optional new category"}
    ],
    "delete_node_ids": ["node_id"],
    "add_edges": [
      {"id": "optional_edge_id", "source": "node_a", "target": "node_b", "label": "optional label"}
    ],
    "edit_edges": [
      {"id": "edge_id", "label": "optional new label"}
    ],
    "delete_edge_ids": ["edge_id"]
  }
}

Rules:
- Do not include prose outside the JSON object.
- Use graph IDs exactly as provided in context.
- If selected_node_ids is non-empty, only mutate those existing nodes.
- Never create orphan edges.
- If request is unclear or cannot be applied safely, return an empty diff and explain in assistant_message.
- assistant_message must explain the full plan before approval: what will be added/edited/removed,
  expected impact/trade-offs, and a clear approval cue to click "Implement plan".
- assistant_message must not claim that Terraform was regenerated. Terraform regeneration is always manual.
- For cost reduction: analyze current cost_estimate data, prioritize rightsizing expensive components first.
  Explain in assistant_message which specific changes reduce cost and by how much.
- For compute migration (e.g., "use serverless instead of EC2"): remove old compute nodes, add new ones,
  update edges to connect the new service. Explain the trade-offs.
- For adding services (e.g., "add a CDN"): add the new node with proper category and edges to existing nodes.
- For removing services: delete the node and its edges; add replacement if needed.
- For security hardening: add WAF, Security Groups, or IAM nodes as appropriate.
- For reliability improvements: suggest multi-AZ, Auto Scaling, or redundant services.
- For simplification: consolidate services, remove unnecessary components.
"""


def _normalize_history(history: Any) -> list[dict[str, str]]:
    if not isinstance(history, list):
        return []

    messages: list[dict[str, str]] = []
    for entry in history[-8:]:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    return messages


def _extract_json_object(raw: str) -> dict[str, Any]:
    value = raw.strip()
    if value.startswith("```"):
        value = value.strip("`")
        if value.startswith("json"):
            value = value[4:].strip()

    start = value.find("{")
    end = value.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not include a JSON object.")

    return json.loads(value[start : end + 1])


def build_mutation_context(
    project_state: dict[str, Any],
    user_goal: str,
    selected_node_ids: list[str] | None = None,
    user_constraints: list[str] | None = None,
) -> dict[str, Any]:
    selected = [entry for entry in (selected_node_ids or []) if isinstance(entry, str) and entry]
    constraints = [entry for entry in (user_constraints or []) if isinstance(entry, str) and entry.strip()]

    return {
        "user_goal": user_goal,
        "user_constraints": constraints,
        "scope": "selected" if selected else "all",
        "selected_node_ids": selected,
        "graph_snapshot": {
            "nodes": project_state.get("nodes") if isinstance(project_state.get("nodes"), list) else [],
            "edges": project_state.get("edges") if isinstance(project_state.get("edges"), list) else [],
        },
        "cost_estimate": project_state.get("cost_estimate"),
        "architecture_description": project_state.get("description"),
        "terraform_files": project_state.get("terraform_files") if isinstance(project_state.get("terraform_files"), list) else [],
    }


async def run_mutation_agent(
    user_goal: str,
    project_state: dict[str, Any],
    selected_node_ids: list[str] | None = None,
    history: list[dict[str, Any]] | None = None,
    llm_creds: dict[str, Any] | None = None,
    user_constraints: list[str] | None = None,
) -> MutationPlan:
    context = build_mutation_context(
        project_state=project_state,
        user_goal=user_goal,
        selected_node_ids=selected_node_ids,
        user_constraints=user_constraints,
    )

    messages = [
        *_normalize_history(history or []),
        {
            "role": "user",
            "content": json.dumps(context, indent=2, ensure_ascii=True),
        },
    ]
    raw = await async_complete(messages=messages, system=MUTATION_SYSTEM_PROMPT, llm_creds=llm_creds)

    try:
        payload = _extract_json_object(raw)
        plan = MutationPlan.model_validate(payload)
    except Exception as error:
        raise RuntimeError(
            "Mutation planner returned an invalid response. "
            "Please retry with a more specific change request."
        ) from error

    if not plan.assistant_message.strip():
        raise RuntimeError("Mutation planner did not return an assistant_message.")

    return plan
