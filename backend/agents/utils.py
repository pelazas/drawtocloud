from typing import Any


def enrich_requirements(requirements: dict, diagram_nodes: list | None) -> dict:
    """Return requirements enriched with a compact architect diagram summary.

    Adds an ``architect_diagram`` key containing a compact comma-separated
    string like ``"VPC(network), ALB(compute), RDS PostgreSQL(database)"``
    derived from the React-Flow node list the Architect agent produced.
    This reduces input tokens by ~70% compared to a full JSON node array
    while preserving all information the coder needs (label + category).

    When ``diagram_nodes`` is absent or empty the original requirements
    dict is returned unchanged.
    """
    if not diagram_nodes:
        return requirements
    compact = ", ".join(
        f"{n.get('data', {}).get('label', n.get('id', '?'))}({n.get('data', {}).get('category', '?')})"
        for n in diagram_nodes
    )
    return {**requirements, "architect_diagram": compact}
