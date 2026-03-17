from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NodeAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    label: str
    category: str = "compute"
    type: str | None = None
    parent_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] | None = None


class NodeEdit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    label: str | None = None
    category: str | None = None
    type: str | None = None
    parent_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class EdgeAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    source: str
    target: str
    label: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class EdgeEdit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    source: str | None = None
    target: str | None = None
    label: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class GraphDiff(BaseModel):
    model_config = ConfigDict(extra="ignore")

    add_nodes: list[NodeAdd] = Field(default_factory=list)
    edit_nodes: list[NodeEdit] = Field(default_factory=list)
    delete_node_ids: list[str] = Field(default_factory=list)
    add_edges: list[EdgeAdd] = Field(default_factory=list)
    edit_edges: list[EdgeEdit] = Field(default_factory=list)
    delete_edge_ids: list[str] = Field(default_factory=list)

    def is_empty(self) -> bool:
        return (
            not self.add_nodes
            and not self.edit_nodes
            and not self.delete_node_ids
            and not self.add_edges
            and not self.edit_edges
            and not self.delete_edge_ids
        )


class MutationPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")

    assistant_message: str
    reasoning: str = ""
    constraints_respected: list[str] = Field(default_factory=list)
    diff: GraphDiff = Field(default_factory=GraphDiff)
