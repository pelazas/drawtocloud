from agents.mutation_apply import GraphMutationApplyError, apply_graph_mutation
from agents.mutation_schema import GraphDiff


def test_apply_graph_mutation_applies_node_and_edge_changes_safely():
    nodes = [
        {"id": "alb", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "ALB", "category": "network"}},
        {"id": "ecs", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "ECS", "category": "compute"}},
        {"id": "rds", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "RDS", "category": "database"}},
    ]
    edges = [{"id": "alb-ecs", "source": "alb", "target": "ecs", "label": "routes"}]
    diff = GraphDiff.model_validate(
        {
            "edit_nodes": [{"id": "rds", "label": "Aurora Serverless v2"}],
            "add_nodes": [{"id": "redis", "label": "Redis Cache", "category": "database"}],
            "delete_node_ids": ["ecs"],
            "add_edges": [{"source": "alb", "target": "redis", "label": "cache lookup"}],
        }
    )

    result = apply_graph_mutation(nodes, edges, diff)

    ids = {node["id"] for node in result["nodes"]}
    assert "ecs" not in ids
    assert "redis" in ids
    renamed_rds = next(node for node in result["nodes"] if node["id"] == "rds")
    assert renamed_rds["data"]["label"] == "Aurora Serverless v2"
    assert all(edge["source"] in ids and edge["target"] in ids for edge in result["edges"])
    assert result["summary"]["nodes_added"] == 1
    assert result["summary"]["nodes_deleted"] == 1


def test_apply_graph_mutation_rejects_duplicate_node_ids():
    nodes = [{"id": "rds", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "RDS", "category": "database"}}]
    edges: list[dict] = []
    diff = GraphDiff.model_validate({"add_nodes": [{"id": "rds", "label": "Duplicate RDS"}]})

    try:
        apply_graph_mutation(nodes, edges, diff)
        raised = False
    except GraphMutationApplyError as error:
        raised = True
        assert "already exists" in str(error)

    assert raised is True


def test_apply_graph_mutation_enforces_selected_scope_for_edits():
    nodes = [
        {"id": "alb", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "ALB", "category": "network"}},
        {"id": "rds", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "RDS", "category": "database"}},
    ]
    edges: list[dict] = []
    diff = GraphDiff.model_validate({"edit_nodes": [{"id": "alb", "label": "Public ALB"}]})

    try:
        apply_graph_mutation(nodes, edges, diff, selected_node_ids=["rds"])
        raised = False
    except GraphMutationApplyError as error:
        raised = True
        assert "selected nodes" in str(error)

    assert raised is True


def test_apply_graph_mutation_ignores_missing_edge_deletes_as_noop():
    nodes = [
        {"id": "a", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "A", "category": "compute"}},
        {"id": "b", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "B", "category": "compute"}},
    ]
    edges = [{"id": "a-b", "source": "a", "target": "b", "label": ""}]
    diff = GraphDiff.model_validate({"delete_edge_ids": ["missing-edge-id"]})

    result = apply_graph_mutation(nodes, edges, diff)

    assert len(result["edges"]) == 1
    assert result["edges"][0]["id"] == "a-b"
    assert result["summary"]["edges_deleted"] == 0
