import json
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


SAMPLE_INFRACOST_OUTPUT = {
    "projects": [
        {
            "breakdown": {
                "resources": [
                    {"name": "aws_instance.web", "resourceType": "aws_instance", "monthlyCost": "72.00"},
                    {"name": "aws_db_instance.main", "resourceType": "aws_db_instance", "monthlyCost": "48.00"},
                    {"name": "aws_lb.alb", "resourceType": "aws_lb", "monthlyCost": "0"},
                ]
            }
        }
    ]
}

SAMPLE_HCL = 'resource "aws_instance" "web" { instance_type = "t3.micro" }'

SAMPLE_CLAUDE_ESTIMATE = json.dumps({
    "monthly_total": 120.0,
    "currency": "USD",
    "line_items": [{"service": "EC2", "resource_type": "aws_instance", "monthly_cost": 120.0}],
    "generated_by": "claude_estimate",
    "note": "Estimated — connect Infracost for accurate pricing",
})


def test_infracost_happy_path():
    """When infracost runs successfully, sends cost_estimate with parsed data."""
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = json.dumps(SAMPLE_INFRACOST_OUTPUT)

    async def run():
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(return_value=SAMPLE_HCL)):
            with patch("subprocess.run", return_value=mock_result):
                from agents.cost_analyst import run_cost_analyst
                await run_cost_analyst({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    types = [m["type"] for m in sent]
    assert "cost_status" in types
    assert "cost_estimate" in types

    estimate = next(m for m in sent if m["type"] == "cost_estimate")
    assert estimate["data"]["monthly_total"] == 120.0
    assert estimate["data"]["generated_by"] == "infracost"
    assert len(estimate["data"]["line_items"]) == 2  # zero-cost item filtered out


def test_infracost_not_available_falls_back_to_claude():
    """FileNotFoundError → falls back to Claude estimate."""
    async def run():
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(side_effect=[
            SAMPLE_HCL,          # first call: HCL generation
            SAMPLE_CLAUDE_ESTIMATE,  # second call: fallback estimate
        ])):
            with patch("subprocess.run", side_effect=FileNotFoundError("infracost not found")):
                from agents.cost_analyst import run_cost_analyst
                await run_cost_analyst({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    types = [m["type"] for m in sent]
    assert "cost_estimate" in types
    estimate = next(m for m in sent if m["type"] == "cost_estimate")
    assert estimate["data"]["generated_by"] == "claude_estimate"


def test_parse_infracost_output():
    """Unit test: _parse_infracost_output produces correct shape."""
    from agents.cost_analyst import _parse_infracost_output
    result = _parse_infracost_output(SAMPLE_INFRACOST_OUTPUT)
    assert result["monthly_total"] == 120.0
    assert result["currency"] == "USD"
    assert result["generated_by"] == "infracost"
    assert len(result["line_items"]) == 2  # zero-cost filtered
    assert result["line_items"][0]["monthly_cost"] >= result["line_items"][1]["monthly_cost"]
