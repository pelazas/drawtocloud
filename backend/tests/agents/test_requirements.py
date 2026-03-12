import pytest
from unittest.mock import patch
from agents.requirements import generate_requirements

VALID_RESPONSE = '{"app_type":"saas_web_app","stage":"mvp","scale":"small","compute":"ecs_fargate","databases":["rds_postgres"],"needs_cdn":false,"needs_load_balancer":true,"needs_ssl":true,"compliance":[],"multi_region":false,"estimated_monthly_cost_tier":"low","architecture_style":"simple_three_tier","inferred_services":["VPC","ALB","ECS Fargate","RDS PostgreSQL","CloudWatch"],"notes":"Solo MVP."}'


@pytest.mark.asyncio
async def test_generate_requirements_returns_dict():
    with patch("agents.requirements.async_complete", return_value=VALID_RESPONSE):
        result = await generate_requirements({"app_type": "Web app", "stage": "MVP", "team_size": "Solo founder"})
    assert isinstance(result, dict)
    assert "inferred_services" in result
    assert isinstance(result["inferred_services"], list)
    assert result["architecture_style"] in {
        "simple_three_tier", "serverless", "data_pipeline",
        "microservices", "static_with_api", "ml_workload",
    }


@pytest.mark.asyncio
async def test_generate_requirements_strips_json_fences():
    fenced = f"```json\n{VALID_RESPONSE}\n```"
    with patch("agents.requirements.async_complete", return_value=fenced):
        result = await generate_requirements({})
    assert result["app_type"] == "saas_web_app"


@pytest.mark.asyncio
async def test_generate_requirements_raises_on_invalid_json():
    with patch("agents.requirements.async_complete", return_value="not json"):
        with pytest.raises(ValueError, match="invalid JSON"):
            await generate_requirements({})
