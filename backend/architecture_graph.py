"""Architecture graph analysis, normalization and repair.

Enforces AWS container hierarchy rules on architect output before final persistence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


VALID_CONTAINER_TYPES = {"region", "vpc", "az", "subnet"}
VALID_CATEGORIES = {"network", "compute", "database", "storage", "security", "monitoring"}

ALLOWED_ROOT_SERVICES = {
    "CloudWatch", "Route 53", "WAF", "S3",
}


class ArchitectureGraphError(RuntimeError):
    """Raised when graph normalization encounters an ambiguous or invalid state."""
    pass


@dataclass
class NormalizedArchitecture:
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


def container_scope(node: dict[str, Any]) -> str | None:
    """Return the container_type of a node, or None if it is not a container."""
    if node.get("type") != "container":
        return None
    return node.get("data", {}).get("containerType")


def is_container(node: dict[str, Any]) -> bool:
    return node.get("type") == "container"


def is_service(node: dict[str, Any]) -> bool:
    return node.get("type") == "service"


def allowed_root_level_service(node: dict[str, Any]) -> bool:
    """Return True if a service is allowed to be root-level (outside VPC hierarchy)."""
    label = node.get("data", {}).get("label", "")
    return label in ALLOWED_ROOT_SERVICES


def build_node_index(nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in nodes}


def children_by_parent(nodes: list[dict[str, Any]]) -> dict[str | None, list[dict[str, Any]]]:
    """Return a mapping from parent_id (or None for root) to child nodes."""
    result: dict[str | None, list[dict[str, Any]]] = {}
    for node in nodes:
        parent_id = node.get("parentId")
        if parent_id not in result:
            result[parent_id] = []
        result[parent_id].append(node)
    return result


def _descendant_subnet_ids(
    node_id: str,
    children: dict[str | None, list[dict[str, Any]]],
) -> list[str]:
    """Return all subnet descendant IDs reachable from node_id."""
    result: list[str] = []
    to_visit = list(children.get(node_id, []))
    while to_visit:
        child = to_visit.pop(0)
        if is_container(child) and container_scope(child) == "subnet":
            result.append(child["id"])
        to_visit.extend(children.get(child["id"], []))
    return result


def _should_reparent_service(
    service: dict[str, Any],
    index: dict[str, dict[str, Any]],
    children: dict[str | None, list[dict[str, Any]]],
) -> tuple[bool, str | None]:
    """Determine if a service should be reparented deeper in the hierarchy.

    Returns (should_reparent, new_parent_id or None).
    Only reparent when there is exactly one valid deepest destination.
    """
    current_parent_id = service.get("parentId")
    if not current_parent_id:
        return False, None

    current_parent = index.get(current_parent_id)
    if not current_parent or not is_container(current_parent):
        return False, None

    current_scope = container_scope(current_parent)
    if current_scope not in {"vpc", "az"}:
        return False, None

    descendant_subnets = _descendant_subnet_ids(current_parent_id, children)
    if len(descendant_subnets) > 1:
        raise ArchitectureGraphError(
            f"Ambiguous placement for service '{service['id']}': multiple subnet descendants exist under '{current_parent_id}'"
        )

    if len(descendant_subnets) == 1:
        return True, descendant_subnets[0]

    return False, None


def _has_service_descendant(
    node_id: str,
    children: dict[str | None, list[dict[str, Any]]],
    index: dict[str, dict[str, Any]],
) -> bool:
    """Return True if any descendant of node_id (at any depth) is a service."""
    to_visit = list(children.get(node_id, []))
    while to_visit:
        child = to_visit.pop(0)
        if is_service(child):
            return True
        to_visit.extend(children.get(child["id"], []))
    return False


def _prune_empty_containers(
    nodes: list[dict[str, Any]],
    index: dict[str, dict[str, Any]],
    children: dict[str | None, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Remove empty az/subnet containers that have no service descendants."""
    to_remove: set[str] = set()

    for node in nodes:
        if is_container(node):
            scope = container_scope(node)
            if scope not in {"az", "subnet"}:
                continue
            if not _has_service_descendant(node["id"], children, index):
                to_remove.add(node["id"])

    return [n for n in nodes if n["id"] not in to_remove]


def normalize_architecture_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> NormalizedArchitecture:
    """Normalize architect output graph by enforcing AWS container hierarchy rules.

    Repair rules:
    - If a service is under vpc/az while a subnet exists in that branch,
      move the service to the deepest unambiguous subnet.
    - If multiple candidate subnets exist, do not guess — raise ArchitectureGraphError.
    - Empty az/subnet containers with no service descendants are pruned.
    - Top-level containers (region, vpc) are never pruned.
    - Allowed root-level services (CloudWatch, Route 53, WAF, S3) stay root-level.

    Only deterministic repairs are applied.
    """
    if not nodes:
        return NormalizedArchitecture(nodes=nodes, edges=edges)

    index = build_node_index(nodes)
    children = children_by_parent(nodes)
    warnings: list[str] = []

    repaired_nodes: list[dict[str, Any]] = []
    for node in nodes:
        repaired_nodes.append(dict(node))

    for node in repaired_nodes:
        if is_service(node):
            should_reparent, new_parent = _should_reparent_service(node, index, children)
            if should_reparent and new_parent:
                old_parent = node.get("parentId")
                node["parentId"] = new_parent
                warnings.append(
                    f"Reparented service '{node['id']}' from '{old_parent}' to '{new_parent}'"
                )

    index = build_node_index(repaired_nodes)
    children = children_by_parent(repaired_nodes)
    repaired_nodes = _prune_empty_containers(repaired_nodes, index, children)

    return NormalizedArchitecture(nodes=repaired_nodes, edges=list(edges), warnings=warnings)
