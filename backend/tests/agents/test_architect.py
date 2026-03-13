import pytest
import json
from unittest.mock import patch, AsyncMock


async def fake_stream(*args, **kwargs):
    lines = [
        '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n',
        "This is a preamble line the model shouldn't output\n",
        '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute"}\n',
        '{"action": "add_edge", "from": "vpc", "to": "ecs", "label": "routes to"}\n',
    ]
    for chunk in lines:
        yield chunk


@pytest.mark.asyncio
async def test_stream_architecture_sends_valid_events():
    mock_ws = AsyncMock()
    with patch("agents.architect.async_stream_text", fake_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({"inferred_services": ["VPC", "ECS"]}, mock_ws)

    calls = [json.loads(call.args[0]) for call in mock_ws.send_text.call_args_list]
    diagram_events = [payload for payload in calls if payload.get("type") == "diagram_event"]
    assert len(diagram_events) == 3  # 2 add_node + 1 add_edge; preamble line skipped


@pytest.mark.asyncio
async def test_stream_architecture_skips_noisy_lines():
    mock_ws = AsyncMock()

    async def noisy_stream(*args, **kwargs):
        yield "Here is the architecture:\n"
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'

    with patch("agents.architect.async_stream_text", noisy_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(call.args[0]) for call in mock_ws.send_text.call_args_list]
    diagram_events = [payload for payload in calls if payload.get("type") == "diagram_event"]
    assert len(diagram_events) == 1  # only the valid JSON line
