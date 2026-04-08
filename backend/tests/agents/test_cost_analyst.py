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
async def test_cost_analyst_includes_unpriced_items_with_zero_cost(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        result = await run_cost_analyst(
            nodes=[{"id": "mystery", "data": {"label": "Custom Internal Service"}}],
            regions=["us-east-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["monthly_total"] == 0.0
    assert result["items"] == [
        {
            "node_id": "mystery",
            "label": "Custom Internal Service",
            "cost": 0.0,
            "estimated": True,
            "unpriced": True,
        }
    ]


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


@pytest.mark.asyncio
async def test_cost_analyst_usage_profile_scales_variable_costs(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        baseline = await run_cost_analyst(
            nodes=[{"id": "api", "data": {"label": "API Gateway", "aws_service_code": "AmazonApiGateway"}}],
            regions=["us-east-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )
        scaled = await run_cost_analyst(
            nodes=[{"id": "api", "data": {"label": "API Gateway", "aws_service_code": "AmazonApiGateway"}}],
            regions=["us-east-1"],
            project_id="project-123",
            runtime=RuntimeStub(),
            usage_profile={
                "requests_per_month": 5_000_000,
                "monthly_active_users": 60_000,
                "monthly_traffic_gb": 8_000,
            },
        )

    assert baseline is not None
    assert scaled is not None
    assert scaled["monthly_total"] > baseline["monthly_total"]
    assert isinstance(scaled.get("scenarios"), dict)
    assert scaled["scenarios"]["expected_total"] == scaled["monthly_total"]
    assert scaled["scenarios"]["peak_total"] > scaled["scenarios"]["expected_total"]


@pytest.mark.asyncio
async def test_cost_analyst_usage_profile_adds_expected_cost_per_item(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    result = await run_cost_analyst(
        nodes=[
            {"id": "ddb", "data": {"label": "DynamoDB", "aws_service_code": "AmazonDynamoDB"}},
            {"id": "s3", "data": {"label": "S3 Bucket", "aws_service_code": "AmazonS3"}},
        ],
        regions=["us-east-1"],
        project_id="project-123",
        runtime=RuntimeStub(),
        usage_profile={
            "requests_per_month": 2_000_000,
            "monthly_active_users": 25_000,
            "monthly_traffic_gb": 2_500,
        },
    )

    assert result is not None
    assert isinstance(result.get("items"), list)
    for entry in result["items"]:
        assert "expected_cost" in entry
        assert entry["expected_cost"] >= entry["cost"]


@pytest.mark.asyncio
async def test_cost_analyst_treats_structural_network_containers_as_zero_cost(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        result = await run_cost_analyst(
            nodes=[
                {
                    "id": "vpc",
                    "type": "container",
                    "data": {
                        "label": "VPC",
                        "aws_service_code": "AmazonVPC",
                        "containerType": "vpc",
                    },
                },
                {
                    "id": "az_a",
                    "type": "container",
                    "data": {
                        "label": "Availability Zone A",
                        "aws_service_code": "AmazonVPC",
                        "containerType": "az",
                    },
                },
                {
                    "id": "private_subnet_a",
                    "type": "container",
                    "data": {
                        "label": "Private Subnet",
                        "aws_service_code": "AmazonVPC",
                        "containerType": "subnet",
                    },
                },
            ],
            regions=["eu-west-3"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["monthly_total"] == 0.0
    assert result["items"] == [
        {"node_id": "vpc", "label": "VPC", "cost": 0.0, "estimated": True},
        {"node_id": "az_a", "label": "Availability Zone A", "cost": 0.0, "estimated": True},
        {"node_id": "private_subnet_a", "label": "Private Subnet", "cost": 0.0, "estimated": True},
    ]


@pytest.mark.asyncio
async def test_cost_analyst_keeps_nat_gateway_as_billable_network_feature(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    with patch("agents.cost_analyst._fetch_hourly_instance_price", new=AsyncMock(return_value=None)):
        result = await run_cost_analyst(
            nodes=[{"id": "nat", "data": {"label": "NAT Gateway", "aws_service_code": "AmazonVPC"}}],
            regions=["eu-west-3"],
            project_id="project-123",
            runtime=RuntimeStub(),
        )

    assert result is not None
    assert result["monthly_total"] == 35.0
    assert result["items"] == [
        {"node_id": "nat", "label": "NAT Gateway", "cost": 35.0, "estimated": True}
    ]
