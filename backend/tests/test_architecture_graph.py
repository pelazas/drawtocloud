"""Tests for architecture_graph normalization and repair logic."""

import pytest

from architecture_graph import (
    ALLOWED_ROOT_SERVICES,
    ArchitectureGraphError,
    NormalizedArchitecture,
    allowed_root_level_service,
    build_node_index,
    children_by_parent,
    container_scope,
    is_container,
    is_service,
    normalize_architecture_graph,
)


def make_node(
    node_id: str,
    node_type: str,
    container_type: str | None = None,
    category: str | None = None,
    label: str | None = None,
    parent_id: str | None = None,
) -> dict:
    node = {"id": node_id, "type": node_type}
    if node_type == "container" and container_type:
        node["data"] = {"containerType": container_type, "label": label or node_id}
    elif node_type == "service":
        node["data"] = {"label": label or node_id, "category": category or "compute"}
    if parent_id is not None:
        node["parentId"] = parent_id
    return node


class TestContainerScope:
    def test_container_returns_scope(self):
        node = make_node("vpc", "container", container_type="vpc")
        assert container_scope(node) == "vpc"

    def test_service_returns_none(self):
        node = make_node("ecs", "service", category="compute")
        assert container_scope(node) is None


class TestIsContainer:
    def test_container_node(self):
        assert is_container(make_node("vpc", "container", container_type="vpc")) is True

    def test_service_node(self):
        assert is_container(make_node("ecs", "service", category="compute")) is False


class TestAllowedRootLevelService:
    def test_cloudwatch_allowed(self):
        node = make_node("cloudwatch", "service", category="monitoring", label="CloudWatch")
        assert allowed_root_level_service(node) is True

    def test_route53_allowed(self):
        node = make_node("route53", "service", category="network", label="Route 53")
        assert allowed_root_level_service(node) is True

    def test_ecs_not_allowed(self):
        node = make_node("ecs", "service", category="compute", label="ECS")
        assert allowed_root_level_service(node) is False


class TestNormalizeArchitectureGraph:
    def test_empty_graph(self):
        result = normalize_architecture_graph([], [])
        assert result.nodes == []
        assert result.edges == []
        assert result.warnings == []

    def test_valid_hierarchy_unchanged(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="subnet_a"),
        ]
        result = normalize_architecture_graph(nodes, [])
        assert len(result.nodes) == 4
        ecs = next(n for n in result.nodes if n["id"] == "ecs")
        assert ecs["parentId"] == "subnet_a"

    def test_service_under_vpc_reparented_to_subnet(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="vpc"),
        ]
        result = normalize_architecture_graph(nodes, [])
        ecs = next(n for n in result.nodes if n["id"] == "ecs")
        assert ecs["parentId"] == "subnet_a"
        assert any("Reparented" in w for w in result.warnings)

    def test_service_under_az_reparented_to_subnet(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="az_a"),
        ]
        result = normalize_architecture_graph(nodes, [])
        ecs = next(n for n in result.nodes if n["id"] == "ecs")
        assert ecs["parentId"] == "subnet_a"

    def test_service_under_subnet_unchanged(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="subnet_a"),
        ]
        result = normalize_architecture_graph(nodes, [])
        ecs = next(n for n in result.nodes if n["id"] == "ecs")
        assert ecs["parentId"] == "subnet_a"

    def test_allowed_root_service_unchanged(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("cloudwatch", "service", category="monitoring", label="CloudWatch"),
        ]
        result = normalize_architecture_graph(nodes, [])
        cw = next(n for n in result.nodes if n["id"] == "cloudwatch")
        assert "parentId" not in cw

    def test_multiple_subnets_raises_architecture_graph_error(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("subnet_b", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="vpc"),
        ]
        with pytest.raises(ArchitectureGraphError, match="Ambiguous placement"):
            normalize_architecture_graph(nodes, [])

    def test_prunes_empty_subnet(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("cloudwatch", "service", category="monitoring", label="CloudWatch"),
        ]
        result = normalize_architecture_graph(nodes, [])
        ids = {n["id"] for n in result.nodes}
        assert "subnet_a" not in ids
        assert "az_a" not in ids
        assert "vpc" in ids
        assert "cloudwatch" in ids

    def test_preserves_non_empty_az(self):
        nodes = [
            make_node("vpc", "container", container_type="vpc"),
            make_node("az_a", "container", container_type="az", parent_id="vpc"),
            make_node("subnet_a", "container", container_type="subnet", parent_id="az_a"),
            make_node("ecs", "service", category="compute", parent_id="subnet_a"),
        ]
        result = normalize_architecture_graph(nodes, [])
        ids = {n["id"] for n in result.nodes}
        assert "az_a" in ids
        assert "subnet_a" in ids
