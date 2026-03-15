import pytest
import json
from unittest.mock import patch, AsyncMock, call


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


# --- BUG-3 tests ---


@pytest.mark.asyncio
async def test_parse_failures_before_first_node_are_silent():
    """Bad lines before first valid node must be silently skipped (normal preamble)."""
    mock_ws = AsyncMock()

    async def pre_node_bad_stream(*args, **kwargs):
        yield "Here is the architecture:\n"
        yield "Some explanation text\n"
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'

    with patch("agents.architect.async_stream_text", pre_node_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            # Should not raise
            await stream_architecture({}, mock_ws)

    all_calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    # No pipeline_event warning should have been emitted for pre-node bad lines
    warnings = [p for p in all_calls if p.get("type") == "pipeline_event" and p.get("level") == "warning"]
    assert warnings == []
    # The valid node was still emitted
    diagram_events = [p for p in all_calls if p.get("type") == "diagram_event"]
    assert len(diagram_events) == 1


@pytest.mark.asyncio
async def test_parse_failures_after_first_node_emit_warning():
    """A bad line after the first valid node must emit a pipeline_event warning."""
    mock_ws = AsyncMock()

    async def post_node_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "Unexpected prose after first node\n"

    with patch("agents.architect.async_stream_text", post_node_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    all_calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    warnings = [p for p in all_calls if p.get("type") == "pipeline_event" and p.get("level") == "warning"]
    assert len(warnings) >= 1


@pytest.mark.asyncio
async def test_three_consecutive_bad_lines_raise_after_first_node():
    """3 consecutive bad lines after first valid node must raise RuntimeError."""
    mock_ws = AsyncMock()

    async def three_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield "bad line 2\n"
        yield "bad line 3\n"

    with patch("agents.architect.async_stream_text", three_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(RuntimeError):
                await stream_architecture({}, mock_ws)


@pytest.mark.asyncio
async def test_resets_counter_on_good_line():
    """Counter resets after a good line — 1 bad line each time never triggers raise."""
    mock_ws = AsyncMock()

    async def interleaved_stream(*args, **kwargs):
        # Pattern: good, bad, good, bad, good, bad, good — never 3 consecutive bad
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute"}\n'
        yield "bad line 2\n"
        yield '{"action": "add_node", "id": "rds", "label": "RDS", "category": "database"}\n'
        yield "bad line 3\n"
        yield '{"action": "add_node", "id": "s3", "label": "S3", "category": "storage"}\n'

    with patch("agents.architect.async_stream_text", interleaved_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            # Should NOT raise despite 3 total bad lines (never consecutive)
            await stream_architecture({}, mock_ws)

    all_calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in all_calls if p.get("type") == "diagram_event"]
    assert len(diagram_events) == 4  # all 4 good nodes emitted
