import copy
import re
from typing import Any

from agents.mutation_schema import GraphDiff


class GraphMutationApplyError(Exception):
    """Raised when a mutation diff is invalid or unsafe to apply."""


def _slugify(value: str) -> str:
    lowered = value.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", lowered).strip("_")
    return normalized or "node"


def _ensure_unique_id(base_id: str, used_ids: set[str]) -> str:
    if base_id not in used_ids:
        return base_id
    suffix = 2
    while True:
        candidate = f"{base_id}_{suffix}"
        if candidate not in used_ids:
            return candidate
        suffix += 1


def _clone_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return copy.deepcopy(nodes), copy.deepcopy(edges)


def _node_ids(nodes: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for node in nodes:
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            ids.append(node_id)
    return ids


def _edge_ids(edges: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for edge in edges:
        edge_id = edge.get("id")
        if isinstance(edge_id, str) and edge_id:
            ids.append(edge_id)
    return ids


def _assert_unique(ids: list[str], entity: str) -> None:
    if len(ids) != len(set(ids)):
        raise GraphMutationApplyError(f"Graph has duplicate {entity} ids.")


def _selection_error(node_id: str) -> GraphMutationApplyError:
    return GraphMutationApplyError(
        f"Mutation targets node '{node_id}' outside selected nodes. "
        "Please update only the selected nodes or clear the selection."
    )


def apply_graph_mutation(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    diff: GraphDiff,
    selected_node_ids: list[str] | None = None,
) -> dict[str, Any]:
    next_nodes, next_edges = _clone_graph(nodes, edges)
    selected_set = {entry for entry in (selected_node_ids or []) if isinstance(entry, str) and entry}

    _assert_unique(_node_ids(next_nodes), "node")
    _assert_unique(_edge_ids(next_edges), "edge")

    if selected_set:
        for edit in diff.edit_nodes:
            if edit.id not in selected_set:
                raise _selection_error(edit.id)
        for node_id in diff.delete_node_ids:
            if node_id not in selected_set:
                raise _selection_error(node_id)

    deleted_by_node_prune = 0
    for node_id in diff.delete_node_ids:
        node_exists = any(node.get("id") == node_id for node in next_nodes)
        if not node_exists:
            raise GraphMutationApplyError(f"Cannot delete node '{node_id}' because it does not exist.")

        next_nodes = [node for node in next_nodes if node.get("id") != node_id]
        original_edge_count = len(next_edges)
        next_edges = [edge for edge in next_edges if edge.get("source") != node_id and edge.get("target") != node_id]
        deleted_by_node_prune += original_edge_count - len(next_edges)

    node_lookup: dict[str, dict[str, Any]] = {
        str(node.get("id")): node for node in next_nodes if isinstance(node.get("id"), str) and node.get("id")
    }
    used_node_ids = set(node_lookup.keys())

    normalized_diff = diff.model_dump(mode="python")

    added_node_ids: set[str] = set()
    for index, node_add in enumerate(diff.add_nodes):
        raw_id = (node_add.id or "").strip()
        if raw_id:
            if raw_id in used_node_ids:
                raise GraphMutationApplyError(f"Cannot add node '{raw_id}' because it already exists.")
            node_id = raw_id
        else:
            node_id = _ensure_unique_id(_slugify(node_add.label), used_node_ids)

        parent_id = (node_add.parent_id or "").strip() or None
        if parent_id and parent_id not in used_node_ids:
            raise GraphMutationApplyError(
                f"Cannot add node '{node_id}' because parent node '{parent_id}' does not exist."
            )

        node_type = node_add.type if isinstance(node_add.type, str) and node_add.type in {"service", "container"} else "service"
        position = node_add.position or {"x": 0, "y": 0}
        x_value = position.get("x", 0) if isinstance(position, dict) else 0
        y_value = position.get("y", 0) if isinstance(position, dict) else 0
        x = float(x_value) if isinstance(x_value, (int, float)) else 0.0
        y = float(y_value) if isinstance(y_value, (int, float)) else 0.0
        node_data = {
            **(node_add.data if isinstance(node_add.data, dict) else {}),
            "label": node_add.label,
            "category": node_add.category,
        }
        next_node: dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "position": {"x": x, "y": y},
            "data": node_data,
        }
        if parent_id:
            next_node["parentId"] = parent_id
            next_node["extent"] = "parent"

        next_nodes.append(next_node)
        node_lookup[node_id] = next_node
        used_node_ids.add(node_id)
        added_node_ids.add(node_id)
        normalized_diff["add_nodes"][index]["id"] = node_id

    for node_edit in diff.edit_nodes:
        if node_edit.id not in node_lookup:
            raise GraphMutationApplyError(f"Cannot edit node '{node_edit.id}' because it does not exist.")

        node = node_lookup[node_edit.id]
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        updated_data = {**data}

        if "label" in node_edit.model_fields_set and node_edit.label is not None:
            updated_data["label"] = node_edit.label
        if "category" in node_edit.model_fields_set and node_edit.category is not None:
            updated_data["category"] = node_edit.category
        if node_edit.data:
            updated_data.update(node_edit.data)

        node["data"] = updated_data

        if "type" in node_edit.model_fields_set and node_edit.type:
            node["type"] = node_edit.type

        if "parent_id" in node_edit.model_fields_set:
            parent_id = (node_edit.parent_id or "").strip() or None
            if parent_id and parent_id not in node_lookup:
                raise GraphMutationApplyError(
                    f"Cannot move node '{node_edit.id}' under parent '{parent_id}' because the parent does not exist."
                )
            if parent_id:
                node["parentId"] = parent_id
                node["extent"] = "parent"
            else:
                node.pop("parentId", None)
                node.pop("extent", None)

    edge_lookup: dict[str, dict[str, Any]] = {
        str(edge.get("id")): edge for edge in next_edges if isinstance(edge.get("id"), str) and edge.get("id")
    }
    used_edge_ids = set(edge_lookup.keys())

    explicit_edge_deletes = 0
    for edge_id in diff.delete_edge_ids:
        if edge_id not in edge_lookup:
            raise GraphMutationApplyError(f"Cannot delete edge '{edge_id}' because it does not exist.")
        explicit_edge_deletes += 1
        edge = edge_lookup.pop(edge_id)
        next_edges.remove(edge)
        used_edge_ids.discard(edge_id)

    initial_node_ids = {entry for entry in _node_ids(nodes)}

    for index, edge_add in enumerate(diff.add_edges):
        source = edge_add.source
        target = edge_add.target
        if source not in used_node_ids or target not in used_node_ids:
            raise GraphMutationApplyError(
                f"Cannot add edge '{source} -> {target}' because one or both nodes do not exist."
            )

        if selected_set:
            for endpoint in (source, target):
                if endpoint in initial_node_ids and endpoint not in selected_set and endpoint not in added_node_ids:
                    raise _selection_error(endpoint)

        raw_edge_id = (edge_add.id or "").strip()
        if raw_edge_id:
            if raw_edge_id in used_edge_ids:
                raise GraphMutationApplyError(f"Cannot add edge '{raw_edge_id}' because it already exists.")
            edge_id = raw_edge_id
        else:
            edge_id = _ensure_unique_id(f"{source}-{target}", used_edge_ids)

        next_edge = {
            "id": edge_id,
            "source": source,
            "target": target,
            "label": edge_add.label,
            "animated": True,
            "style": {"stroke": "#6b7280"},
        }
        if edge_add.data:
            next_edge["data"] = edge_add.data

        next_edges.append(next_edge)
        edge_lookup[edge_id] = next_edge
        used_edge_ids.add(edge_id)
        normalized_diff["add_edges"][index]["id"] = edge_id

    for edge_edit in diff.edit_edges:
        if edge_edit.id not in edge_lookup:
            raise GraphMutationApplyError(f"Cannot edit edge '{edge_edit.id}' because it does not exist.")

        edge = edge_lookup[edge_edit.id]
        source = edge.get("source")
        target = edge.get("target")
        if "source" in edge_edit.model_fields_set and edge_edit.source is not None:
            source = edge_edit.source
        if "target" in edge_edit.model_fields_set and edge_edit.target is not None:
            target = edge_edit.target

        if not isinstance(source, str) or not isinstance(target, str):
            raise GraphMutationApplyError(f"Cannot edit edge '{edge_edit.id}' because source/target are invalid.")
        if source not in used_node_ids or target not in used_node_ids:
            raise GraphMutationApplyError(
                f"Cannot edit edge '{edge_edit.id}' because source/target do not exist after mutation."
            )

        if selected_set:
            for endpoint in (source, target):
                if endpoint in initial_node_ids and endpoint not in selected_set and endpoint not in added_node_ids:
                    raise _selection_error(endpoint)

        edge["source"] = source
        edge["target"] = target
        if "label" in edge_edit.model_fields_set and edge_edit.label is not None:
            edge["label"] = edge_edit.label
        if edge_edit.data:
            original_data = edge.get("data") if isinstance(edge.get("data"), dict) else {}
            edge["data"] = {**original_data, **edge_edit.data}

    _assert_unique(_node_ids(next_nodes), "node")
    _assert_unique(_edge_ids(next_edges), "edge")

    valid_node_ids = set(_node_ids(next_nodes))
    for edge in next_edges:
        source = edge.get("source")
        target = edge.get("target")
        if source not in valid_node_ids or target not in valid_node_ids:
            raise GraphMutationApplyError(
                f"Mutation produced orphan edge '{edge.get('id')}' ({source} -> {target})."
            )

    summary = {
        "nodes_added": len(diff.add_nodes),
        "nodes_edited": len(diff.edit_nodes),
        "nodes_deleted": len(diff.delete_node_ids),
        "edges_added": len(diff.add_edges),
        "edges_edited": len(diff.edit_edges),
        "edges_deleted": len(diff.delete_edge_ids) + deleted_by_node_prune,
        "pruned_edges": deleted_by_node_prune,
    }

    return {
        "nodes": next_nodes,
        "edges": next_edges,
        "summary": summary,
        "normalized_diff": normalized_diff,
    }
