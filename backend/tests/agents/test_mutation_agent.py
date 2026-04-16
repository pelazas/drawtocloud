import pytest
from unittest.mock import patch

from agents.mutation_agent import run_mutation_agent

VALID_MUTATION_PLAN = {
    "assistant_message": "I'll reduce costs by rightsizing the ECS cluster from t3.medium to t3.small, saving approximately $15/month. This is safe because the current utilization is only 20%.",
    "reasoning": "Current ECS instance is oversized for actual usage",
    "constraints_respected": ["maintain same AZ coverage"],
    "diff": {
        "edit_nodes": [
            {"id": "ecs_cluster", "data": {"instance_type": "t3.small"}}
        ]
    }
}

PROJECT_STATE_WITH_COST = {
    "nodes": [
        {"id": "vpc", "label": "VPC", "category": "network"},
        {"id": "ecs_cluster", "label": "ECS Cluster", "category": "compute", "data": {"instance_type": "t3.medium"}},
        {"id": "rds", "label": "RDS PostgreSQL", "category": "database", "data": {"instance_type": "db.t3.medium"}},
    ],
    "edges": [
        {"id": "e1", "source": "alb", "target": "ecs_cluster", "label": "routes to"},
    ],
    "cost_estimate": {
        "monthly_total": 145.50,
        "items": [
            {"service": "ECS Cluster", "monthly_cost": 45.00, "cost_drivers": ["instance_type"]},
            {"service": "RDS PostgreSQL", "monthly_cost": 80.00, "cost_drivers": ["instance_type"]},
        ]
    }
}

PROJECT_STATE_WITHOUT_COST = {
    "nodes": [
        {"id": "vpc", "label": "VPC", "category": "network"},
        {"id": "ecs_cluster", "label": "ECS Cluster", "category": "compute", "data": {"instance_type": "t3.medium"}},
    ],
    "edges": [
        {"id": "e1", "source": "alb", "target": "ecs_cluster", "label": "routes to"},
    ],
}


@pytest.mark.asyncio
async def test_broad_cost_reduction_request_fails_with_invalid_json():
    """Test RED: broad cost-reduction request fails with generic error when model returns invalid JSON.

    This test documents the CURRENT broken behavior: the mutation planner raises
    a generic RuntimeError without any repair attempt when the model returns invalid JSON.
    After the fix, this should instead trigger the repair mechanism.
    """
    with patch("agents.mutation_agent.async_complete", return_value="not json at all"):
        with pytest.raises(RuntimeError, match="invalid response"):
            await run_mutation_agent(
                user_goal="can we make this architecture cheaper",
                project_state=PROJECT_STATE_WITH_COST,
            )


@pytest.mark.asyncio
async def test_repair_path_recovers_from_invalid_first_pass():
    """Test that when model returns invalid JSON on first attempt, repair mechanism recovers.

    This test will FAIL with current implementation (no repair path exists).
    After fix: should retry with repair LLM call and succeed on second attempt.
    """
    responses = iter([
        "not valid json",
        '{"assistant_message": "Plan to reduce costs.", "reasoning": "", "diff": {}}',
    ])

    async def fake_complete(*_args, **_kwargs):
        return next(responses)

    with patch("agents.mutation_agent.async_complete", side_effect=fake_complete):
        result = await run_mutation_agent(
            user_goal="can we make this architecture cheaper",
            project_state=PROJECT_STATE_WITH_COST,
        )

    assert result.assistant_message == "Plan to reduce costs."
    assert result.diff is not None


@pytest.mark.asyncio
async def test_cost_optimization_request_produces_valid_plan_with_changes():
    """Test that cost-optimization request with cost_estimate produces a plan with concrete changes.

    The plan should have:
    - non-empty assistant_message referencing cost savings
    - non-empty diff (has concrete graph changes)
    """
    with patch("agents.mutation_agent.async_complete", return_value='{"assistant_message": "I will reduce costs by $15/month by rightsizing ECS from t3.medium to t3.small.", "reasoning": "Current utilization is 20%.", "constraints_respected": [], "diff": {"edit_nodes": [{"id": "ecs_cluster", "data": {"instance_type": "t3.small"}}]}}'):
        result = await run_mutation_agent(
            user_goal="can we make this architecture cheaper",
            project_state=PROJECT_STATE_WITH_COST,
        )

    assert result.assistant_message.strip() != ""
    assert "cost" in result.assistant_message.lower() or "sav" in result.assistant_message.lower()
    assert not result.diff.is_empty()
    assert len(result.diff.edit_nodes) > 0


@pytest.mark.asyncio
async def test_missing_cost_estimate_does_not_block_plan_generation():
    """Test that when cost_estimate is None/missing, planner still produces a plan with assumptions.

    The plan should state explicit assumptions in assistant_message rather than failing.
    """
    with patch("agents.mutation_agent.async_complete", return_value='{"assistant_message": "Without cost data, I assume standard t3.medium pricing. Please verify actual costs before implementing.", "reasoning": "No cost_estimate provided in project state.", "constraints_respected": [], "diff": {"edit_nodes": [{"id": "ecs_cluster", "data": {"instance_type": "t3.small"}}]}}'):
        result = await run_mutation_agent(
            user_goal="can we make this architecture cheaper",
            project_state=PROJECT_STATE_WITHOUT_COST,
        )

    assert result.assistant_message.strip() != ""
    assert "assume" in result.assistant_message.lower() or "without" in result.assistant_message.lower()


@pytest.mark.asyncio
async def test_schema_invalid_json_triggers_repair():
    """Test that schema-invalid JSON (valid JSON but wrong structure) triggers repair mechanism.

    This tests that valid JSON with missing required fields gets repaired.
    """
    responses = iter([
        '{"some": "invalid schema"}',
        '{"assistant_message": "Here is the corrected plan.", "reasoning": "", "diff": {}}',
    ])

    async def fake_complete(*_args, **_kwargs):
        return next(responses)

    with patch("agents.mutation_agent.async_complete", side_effect=fake_complete):
        result = await run_mutation_agent(
            user_goal="can we make this architecture cheaper",
            project_state=PROJECT_STATE_WITH_COST,
        )

    assert result.assistant_message == "Here is the corrected plan."


@pytest.mark.asyncio
async def test_mutation_plan_has_non_empty_diff_for_cost_reduction():
    """Test that cost-reduction mutation plan has non-empty diff."""
    with patch("agents.mutation_agent.async_complete", return_value='{"assistant_message": "Reduce RDS instance type to db.t3.small saving $40/month.", "reasoning": "RDS is oversized.", "constraints_respected": ["maintain data durability"], "diff": {"edit_nodes": [{"id": "rds", "data": {"instance_type": "db.t3.small"}}]}}'):
        result = await run_mutation_agent(
            user_goal="make this architecture cheaper",
            project_state=PROJECT_STATE_WITH_COST,
        )

    assert not result.diff.is_empty()
    assert len(result.diff.edit_nodes) == 1
    assert result.diff.edit_nodes[0].id == "rds"