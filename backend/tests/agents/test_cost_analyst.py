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


def test_subprocess_run_is_called_via_to_thread():
    """BUG-5: asyncio.to_thread must wrap subprocess.run, not call it directly."""
    import subprocess as _subprocess

    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = json.dumps(SAMPLE_INFRACOST_OUTPUT)

    to_thread_calls = []

    async def fake_to_thread(fn, *args, **kwargs):
        to_thread_calls.append(fn)
        # Delegate to the real subprocess.run mock so the rest of the pipeline works
        return fn(*args, **kwargs)

    captured_mock_run = None

    async def run():
        nonlocal captured_mock_run
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(return_value=SAMPLE_HCL)):
            with patch("agents.cost_analyst.subprocess.run", return_value=mock_result) as mock_run:
                captured_mock_run = mock_run
                with patch("agents.cost_analyst.asyncio.to_thread", side_effect=fake_to_thread):
                    from agents.cost_analyst import run_cost_analyst
                    await run_cost_analyst({"app_type": "web"}, ws)
        return to_thread_calls

    calls = asyncio.run(run())
    assert len(calls) >= 1, "asyncio.to_thread was never called"
    # The first positional arg to to_thread must be subprocess.run (the patched mock in the module)
    assert calls[0] is captured_mock_run, (
        f"asyncio.to_thread must be called with subprocess.run as the first argument, got {calls[0]}"
    )


def test_fallback_parse_failure_emits_cost_estimate():
    """BUG-10: When AI fallback returns invalid JSON, a cost_estimate placeholder must be sent."""
    async def run():
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(side_effect=[
            SAMPLE_HCL,          # first call: HCL generation
            "THIS IS NOT JSON",  # second call: broken AI fallback
        ])):
            with patch("subprocess.run", side_effect=FileNotFoundError("infracost not found")):
                from agents.cost_analyst import run_cost_analyst
                await run_cost_analyst({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    types = [m["type"] for m in sent]
    assert "cost_estimate" in types, (
        "A cost_estimate message must be sent even when AI fallback parse fails; "
        f"got types: {types}"
    )
    estimate = next(m for m in sent if m["type"] == "cost_estimate")
    assert estimate["data"]["generated_by"] == "estimation_failed"
    assert estimate["data"]["monthly_total"] == 0


def test_parse_infracost_output():
    """Unit test: _parse_infracost_output produces correct shape."""
    from agents.cost_analyst import _parse_infracost_output
    result = _parse_infracost_output(SAMPLE_INFRACOST_OUTPUT)
    assert result["monthly_total"] == 120.0
    assert result["currency"] == "USD"
    assert result["generated_by"] == "infracost"
    assert len(result["line_items"]) == 2  # zero-cost filtered
    assert result["line_items"][0]["monthly_cost"] >= result["line_items"][1]["monthly_cost"]


def test_primary_llm_timeout_falls_back_to_ai_estimate():
    async def run():
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(side_effect=[
            asyncio.TimeoutError(),
            SAMPLE_CLAUDE_ESTIMATE,
        ])):
            from agents.cost_analyst import run_cost_analyst
            await run_cost_analyst({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    estimate = next(m for m in sent if m["type"] == "cost_estimate")
    assert estimate["data"]["generated_by"] == "claude_estimate"
    timeout_event = next(
        m for m in sent
        if m.get("type") == "pipeline_event" and m.get("stage") == "cost_analyst" and m.get("event") == "llm_timeout_fallback"
    )
    assert timeout_event["level"] == "warning"


def test_fallback_llm_timeout_emits_estimation_failed_placeholder():
    async def run():
        ws = MockWebSocket()
        with patch("agents.cost_analyst.async_complete", new=AsyncMock(side_effect=[
            SAMPLE_HCL,
            asyncio.TimeoutError(),
        ])):
            with patch("subprocess.run", side_effect=FileNotFoundError("infracost not found")):
                from agents.cost_analyst import run_cost_analyst
                await run_cost_analyst({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    estimate = next(m for m in sent if m["type"] == "cost_estimate")
    assert estimate["data"]["generated_by"] == "estimation_failed"
    timeout_event = next(
        m for m in sent
        if m.get("type") == "pipeline_event" and m.get("stage") == "cost_analyst" and m.get("event") == "fallback_timeout"
    )
    assert timeout_event["level"] == "warning"
