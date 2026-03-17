from typing import Any


def enrich_requirements(requirements: dict, diagram_nodes: list | None) -> dict:
    """Return requirements enriched with architect diagram context when available.

    Adds an ``architect_diagram`` key containing a list of
    ``{id, label, category}`` summaries derived from the React-Flow node list
    that the Architect agent produced.  When ``diagram_nodes`` is absent or
    empty the original requirements dict is returned unchanged.
    """
    if not diagram_nodes:
        return requirements
    node_summary = [
        {
            "id": n.get("id"),
            "label": n.get("data", {}).get("label"),
            "category": n.get("data", {}).get("category"),
        }
        for n in diagram_nodes
    ]
    return {**requirements, "architect_diagram": node_summary}
