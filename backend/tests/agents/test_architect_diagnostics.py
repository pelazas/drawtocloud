import pytest
from unittest.mock import patch, AsyncMock

from agents.architect import ArchitectOutputError


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
async def test_architect_output_error_has_raw_preview_attribute():
    """When architect produces invalid output, the raised exception has raw_preview attribute."""
    mock_ws = AsyncMock()

    async def three_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield "bad line 2\n"
        yield "bad line 3\n"

    with patch("agents.architect.async_stream_text", three_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "raw_preview")
            assert isinstance(exc_info.value.raw_preview, str)


@pytest.mark.asyncio
async def test_architect_output_error_has_parse_failure_count_attribute():
    """When architect produces invalid output, the raised exception has parse_failure_count attribute."""
    mock_ws = AsyncMock()

    async def three_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield "bad line 2\n"
        yield "bad line 3\n"

    with patch("agents.architect.async_stream_text", three_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "parse_failure_count")
            assert isinstance(exc_info.value.parse_failure_count, int)


@pytest.mark.asyncio
async def test_architect_output_error_has_validation_failure_count_attribute():
    """When architect produces invalid output, the raised exception has validation_failure_count attribute."""
    mock_ws = AsyncMock()

    async def three_validation_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "bad", "label": "Bad Node", "category": "invalid_category"}\n'
        yield '{"action": "add_node", "id": "bad2", "label": "Bad Node 2", "category": "invalid_category2"}\n'
        yield '{"action": "add_node", "id": "bad3", "label": "Bad Node 3", "category": "invalid_category3"}\n'

    with patch("agents.architect.async_stream_text", three_validation_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "validation_failure_count")
            assert isinstance(exc_info.value.validation_failure_count, int)


@pytest.mark.asyncio
async def test_architect_output_error_has_first_failure_reason_attribute():
    """When architect produces invalid output, the raised exception has first_failure_reason attribute."""
    mock_ws = AsyncMock()

    async def three_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield "bad line 2\n"
        yield "bad line 3\n"

    with patch("agents.architect.async_stream_text", three_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "first_failure_reason")
            assert isinstance(exc_info.value.first_failure_reason, str)


@pytest.mark.asyncio
async def test_architect_output_error_has_first_invalid_preview_attribute():
    """When architect produces invalid output, the raised exception has first_invalid_preview attribute."""
    mock_ws = AsyncMock()

    async def three_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield "bad line 1\n"
        yield "bad line 2\n"
        yield "bad line 3\n"

    with patch("agents.architect.async_stream_text", three_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "first_invalid_preview")
            assert isinstance(exc_info.value.first_invalid_preview, str)


@pytest.mark.asyncio
async def test_architect_succeeds_no_exception_raised():
    """When architect succeeds, no exception is raised."""
    mock_ws = AsyncMock()

    async def good_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute"}\n'
        yield '{"action": "add_edge", "from": "vpc", "to": "ecs", "label": "routes to"}\n'

    with patch("agents.architect.async_stream_text", good_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)
            assert mock_ws.send_text.call_count > 0


@pytest.mark.asyncio
async def test_architect_output_error_inherits_from_runtime_error():
    """ArchitectOutputError must inherit from RuntimeError so existing except RuntimeError clauses catch it."""
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
async def test_zero_valid_nodes_raises_architect_output_error():
    """When architect produces no valid nodes, ArchitectOutputError is raised with diagnostics."""
    mock_ws = AsyncMock()

    async def junk_only_stream(*args, **kwargs):
        yield "Here is your architecture\n"
        yield "Still working on it\n"

    with patch("agents.architect.async_stream_text", junk_only_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert hasattr(exc_info.value, "raw_preview")
            assert exc_info.value.parse_failure_count >= 0
            assert exc_info.value.validation_failure_count >= 0


@pytest.mark.asyncio
async def test_architect_output_error_captured_on_validation_failure():
    """ArchitectOutputError raised on 3 consecutive validation failures contains validation_failure_count."""
    mock_ws = AsyncMock()

    async def three_validation_bad_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "bad", "label": "Bad Node", "category": "invalid_category"}\n'
        yield '{"action": "add_node", "id": "bad2", "label": "Bad Node 2", "category": "invalid_category2"}\n'
        yield '{"action": "add_node", "id": "bad3", "label": "Bad Node 3", "category": "invalid_category3"}\n'

    with patch("agents.architect.async_stream_text", three_validation_bad_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(ArchitectOutputError) as exc_info:
                await stream_architecture({}, mock_ws)
            assert exc_info.value.validation_failure_count == 3
