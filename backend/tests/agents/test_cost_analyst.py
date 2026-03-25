import os
from unittest.mock import AsyncMock, patch

import pytest

from agents.cost_analyst import run_cost_analyst


class RuntimeStub:
    def __init__(self, client_ip: str | None = None) -> None:
        self.client_ip = client_ip


@pytest.mark.asyncio
async def test_cost_analyst_returns_none_without_aws_credentials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)

    result = await run_cost_analyst(
        nodes=[{"id": "n1", "data": {"label": "EC2", "aws_service_code": "AmazonEC2", "instance_type": "t3.micro"}}],
        regions=["us-east-1"],
        project_id="project-123",
        runtime=RuntimeStub(),
    )

    assert result is None


@pytest.mark.asyncio
async def test_cost_analyst_uses_usage_estimate_for_serverless(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        result = await run_cost_analyst(
            nodes=[{"id": "lambda", "data": {"label": "Lambda", "aws_service_code": "AWSLambda"}}],
            regions=["eu-west-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["region"] == "eu-west-1"
    assert result["monthly_total"] == 5.0
    assert result["items"] == [
        {
            "node_id": "lambda",
            "label": "Lambda",
            "cost": 5.0,
            "estimated": True,
        }
    ]


@pytest.mark.asyncio
async def test_cost_analyst_ignores_instance_type_for_usage_service(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    result = await run_cost_analyst(
        nodes=[
            {
                "id": "ddb",
                "data": {
                    "label": "DynamoDB",
                    "aws_service_code": "AmazonDynamoDB",
                    "instance_type": "t3.micro",
                },
            }
        ],
        regions=["eu-central-1"],
        project_id="project-123",
        runtime=RuntimeStub(),
    )

    assert result is not None
    assert result["monthly_total"] == 25.0
    assert result["items"] == [
        {
            "node_id": "ddb",
            "label": "DynamoDB",
            "cost": 25.0,
            "estimated": True,
        }
    ]


@pytest.mark.asyncio
async def test_cost_analyst_uses_keyword_fallback_for_unknown_service(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        result = await run_cost_analyst(
            nodes=[{"id": "redis", "data": {"label": "Redis Cache"}}],
            regions=["us-east-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["monthly_total"] == 40.0
    assert result["items"][0]["estimated"] is True


@pytest.mark.asyncio
async def test_cost_analyst_prices_instance_service_from_hourly_rate(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=0.1)):
        result = await run_cost_analyst(
            nodes=[
                {
                    "id": "ec2",
                    "data": {
                        "label": "EC2 Instance",
                        "aws_service_code": "AmazonEC2",
                        "instance_type": "t3.micro",
                    },
                }
            ],
            regions=["us-east-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["monthly_total"] == 73.0
    assert result["items"] == [
        {
            "node_id": "ec2",
            "label": "EC2 Instance",
            "instance_type": "t3.micro",
            "cost": 73.0,
            "estimated": False,
        }
    ]
