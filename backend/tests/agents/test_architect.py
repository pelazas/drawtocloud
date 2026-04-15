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
async def test_three_bad_lines_before_first_node_do_not_abort():
    """Three bad preamble lines before first node should still allow a valid stream to continue."""
    mock_ws = AsyncMock()

    async def preamble_then_valid_stream(*args, **kwargs):
        yield "line one preamble\n"
        yield "line two preamble\n"
        yield "line three preamble\n"
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'

    with patch("agents.architect.async_stream_text", preamble_then_valid_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    all_calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
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


@pytest.mark.asyncio
async def test_stream_architecture_logs_edge_progress():
    mock_ws = AsyncMock()

    async def stream_with_edge(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute"}\n'
        yield '{"action": "add_edge", "from": "vpc", "to": "ecs", "label": "routes to"}\n'

    with patch("agents.architect.async_stream_text", stream_with_edge):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(call.args[0]) for call in mock_ws.send_text.call_args_list]
    edge_logs = [
        payload
        for payload in calls
        if payload.get("type") == "agent_log"
        and payload.get("agent") == "architect"
        and "Connected" in payload.get("message", "")
    ]
    assert len(edge_logs) == 1


@pytest.mark.asyncio
async def test_stream_architecture_flushes_final_line_without_trailing_newline():
    mock_ws = AsyncMock()

    async def stream_without_newline(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}'

    with patch("agents.architect.async_stream_text", stream_without_newline):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(call.args[0]) for call in mock_ws.send_text.call_args_list]
    diagram_events = [payload for payload in calls if payload.get("type") == "diagram_event"]
    assert len(diagram_events) == 1


@pytest.mark.asyncio
async def test_stream_architecture_raises_when_no_valid_nodes_emitted():
    mock_ws = AsyncMock()

    async def junk_only_stream(*args, **kwargs):
        yield "Here is your architecture\n"
        yield "Still working on it\n"

    with patch("agents.architect.async_stream_text", junk_only_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            with pytest.raises(RuntimeError, match="no valid nodes"):
                await stream_architecture({}, mock_ws)


@pytest.mark.asyncio
async def test_stream_architecture_treats_non_object_json_as_invalid_line():
    mock_ws = AsyncMock()

    async def non_object_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '[]\n'

    with patch("agents.architect.async_stream_text", non_object_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    all_calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    warnings = [p for p in all_calls if p.get("type") == "pipeline_event" and p.get("event") == "parse_warning"]
    diagram_events = [p for p in all_calls if p.get("type") == "diagram_event"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


def test_architect_prompt_supports_nested_container_types():
    from agents.architect import ARCHITECT_SYSTEM

    assert 'container_type": "vpc"' in ARCHITECT_SYSTEM
    assert 'container_type": "az"' in ARCHITECT_SYSTEM
    assert 'container_type": "subnet"' in ARCHITECT_SYSTEM
    assert "vpc -> az -> subnet -> services" in ARCHITECT_SYSTEM
    assert 'container_type": "vpc", "aws_service_code"' not in ARCHITECT_SYSTEM
    assert 'container_type": "az", "parent_id": "vpc", "aws_service_code"' not in ARCHITECT_SYSTEM
    assert 'container_type": "subnet", "parent_id": "az_a", "aws_service_code"' not in ARCHITECT_SYSTEM
    assert "add `aws_service_code` for service nodes only" in ARCHITECT_SYSTEM


def test_architect_prompt_supports_region_container_type():
    """The architect prompt must include region as a container type for multi-region architectures."""
    from agents.architect import ARCHITECT_SYSTEM

    assert 'container_type": "region"' in ARCHITECT_SYSTEM, (
        "Architect prompt must define region as a supported container_type for multi-region diagrams"
    )
    assert "region -> vpc" in ARCHITECT_SYSTEM, (
        "Architect prompt must document the correct region-before-VPC ordering"
    )
    assert "vpc -> region" not in ARCHITECT_SYSTEM, (
        "Architect prompt must not document the incorrect VPC-before-region ordering"
    )
    assert "multi-region" in ARCHITECT_SYSTEM.lower() or "multi_region" in ARCHITECT_SYSTEM.lower(), (
        "Architect prompt must discuss multi-region architecture output rules"
    )


@pytest.mark.asyncio
async def test_stream_architecture_supports_multi_region_with_region_parent():
    """A multi-region stream emitting region -> vpc -> service should send all events with correct parent_id."""
    mock_ws = AsyncMock()

    async def multi_region_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "eu_central_1", "label": "EU Central 1", "category": "network", "node_type": "container", "container_type": "region"}\n'
        yield '{"action": "add_node", "id": "vpc_eu", "label": "VPC EU", "category": "network", "node_type": "container", "container_type": "vpc", "parent_id": "eu_central_1"}\n'
        yield '{"action": "add_node", "id": "ecs_eu", "label": "ECS EU", "category": "compute", "node_type": "service", "parent_id": "vpc_eu"}\n'
        yield '{"action": "add_edge", "from": "vpc_eu", "to": "ecs_eu", "label": "contains"}\n'

    with patch("agents.architect.async_stream_text", multi_region_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({"multi_region": True}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]

    # region node is emitted before vpc, vpc before service
    node_events = [e for e in diagram_events if e.get("action") == "add_node"]
    node_ids = [e.get("id") for e in node_events]
    node_by_id = {e["id"]: e for e in node_events}
    assert node_ids.index("eu_central_1") < node_ids.index("vpc_eu"), "region must come before vpc"
    assert node_ids.index("vpc_eu") < node_ids.index("ecs_eu"), "vpc must come before service"
    assert "parent_id" not in node_by_id["eu_central_1"], "region node must not declare a parent_id"
    assert node_by_id["vpc_eu"].get("parent_id") == "eu_central_1", "vpc must reference region as parent"
    assert node_by_id["ecs_eu"].get("parent_id") == "vpc_eu", "service must reference vpc as parent"


# --- Strict Event Validation Tests ---


@pytest.mark.asyncio
async def test_invalid_action_type():
    """action must be 'add_node' or 'add_edge' — anything else is invalid."""
    mock_ws = AsyncMock()

    async def invalid_action_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "update_node", "id": "vpc", "label": "VPC Updated"}\n'

    with patch("agents.architect.async_stream_text", invalid_action_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_add_node_missing_required_fields():
    """add_node requires id, label, category."""
    mock_ws = AsyncMock()

    async def missing_field_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "label": "ECS", "category": "compute"}\n'

    with patch("agents.architect.async_stream_text", missing_field_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_add_edge_missing_required_fields():
    """add_edge requires from, to, label."""
    mock_ws = AsyncMock()

    async def missing_edge_field_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service"}\n'
        yield '{"action": "add_edge", "from": "vpc", "label": "routes to"}\n'

    with patch("agents.architect.async_stream_text", missing_edge_field_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 2
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_repair_architecture_returns_valid_events():
    """repair_architecture should return a list of valid diagram events."""
    mock_ws = AsyncMock()

    async def repair_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service"}\n'
        yield '{"action": "add_edge", "from": "vpc", "to": "ecs", "label": "contains"}\n'

    from agents.architect import repair_architecture

    with patch("agents.architect.async_stream_text", repair_stream):
        result = await repair_architecture(
            requirements={"app_name": "Demo"},
            invalid_output="bad output",
            error_info={"parse_failure_count": 3, "validation_failure_count": 0, "first_failure_reason": "bad", "first_invalid_preview": "bad line"},
            websocket=mock_ws,
            start_time=0,
        )

    assert len(result) == 3
    assert result[0]["id"] == "vpc"
    assert result[1]["id"] == "ecs"
    assert result[2]["action"] == "add_edge"


@pytest.mark.asyncio
async def test_repair_architecture_validates_each_event():
    """repair_architecture should validate each event and skip invalid ones."""
    mock_ws = AsyncMock()

    async def repair_stream_with_invalid(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
        yield 'invalid json\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service"}\n'

    from agents.architect import repair_architecture

    with patch("agents.architect.async_stream_text", repair_stream_with_invalid):
        result = await repair_architecture(
            requirements={"app_name": "Demo"},
            invalid_output="bad output",
            error_info={"parse_failure_count": 1, "validation_failure_count": 1, "first_failure_reason": "bad", "first_invalid_preview": "bad line"},
            websocket=mock_ws,
            start_time=0,
        )

    assert len(result) == 2
    assert result[0]["id"] == "vpc"
    assert result[1]["id"] == "ecs"


@pytest.mark.asyncio
async def test_repair_architecture_processes_final_line_without_newline():
    """repair_architecture should emit and return a valid final line without trailing newline."""
    mock_ws = AsyncMock()

    async def repair_stream_without_newline(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}'

    from agents.architect import repair_architecture

    with patch("agents.architect.async_stream_text", repair_stream_without_newline):
        result = await repair_architecture(
            requirements={"app_name": "Demo"},
            invalid_output="bad output",
            error_info={"parse_failure_count": 1, "validation_failure_count": 0, "first_failure_reason": "bad", "first_invalid_preview": "bad line"},
            websocket=mock_ws,
            start_time=0,
        )

    assert len(result) == 1
    assert result[0]["id"] == "vpc"
    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    assert len(diagram_events) == 1


@pytest.mark.asyncio
async def test_repair_architecture_raises_when_no_valid_events():
    """repair_architecture should raise ArchitectOutputError when no valid events are produced."""
    mock_ws = AsyncMock()

    async def repair_stream_all_invalid(*args, **kwargs):
        yield 'not valid\n'
        yield 'also not valid\n'
        yield '[]\n'

    from agents.architect import repair_architecture, ArchitectOutputError

    with patch("agents.architect.async_stream_text", repair_stream_all_invalid):
        with pytest.raises(ArchitectOutputError) as exc_info:
            await repair_architecture(
                requirements={"app_name": "Demo"},
                invalid_output="bad output",
                error_info={"parse_failure_count": 3, "validation_failure_count": 0, "first_failure_reason": "bad", "first_invalid_preview": "bad line"},
                websocket=mock_ws,
                start_time=0,
            )

    assert "no valid nodes" in str(exc_info.value).lower() or "no valid events" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_invalid_category():
    """category must be one of the known categories."""
    mock_ws = AsyncMock()

    async def bad_category_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "bad", "label": "Bad Node", "category": "invalid_category"}\n'

    with patch("agents.architect.async_stream_text", bad_category_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_invalid_container_type():
    """container_type must be one of region, vpc, az, subnet."""
    mock_ws = AsyncMock()

    async def bad_container_type_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "bad", "label": "Bad Container", "category": "network", "node_type": "container", "container_type": "invalid_container"}\n'

    with patch("agents.architect.async_stream_text", bad_container_type_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_container_type_on_service_node():
    """container_type is only valid on node_type=container, not on service."""
    mock_ws = AsyncMock()

    async def container_type_on_service_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service", "container_type": "vpc"}\n'

    with patch("agents.architect.async_stream_text", container_type_on_service_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_invalid_node_type():
    """node_type must be 'container' or 'service'."""
    mock_ws = AsyncMock()

    async def bad_node_type_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "bad", "label": "Bad Node", "category": "network", "node_type": "invalid_type"}\n'

    with patch("agents.architect.async_stream_text", bad_node_type_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_edge_referencing_nonexistent_node():
    """add_edge whose from/to references a node that hasn't been emitted must be rejected."""
    mock_ws = AsyncMock()

    async def forward_ref_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service"}\n'
        yield '{"action": "add_edge", "from": "ecs", "to": "rds", "label": "reads from"}\n'

    with patch("agents.architect.async_stream_text", forward_ref_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_duplicate_node_id():
    """Two add_node events with the same id must cause the second to be rejected."""
    mock_ws = AsyncMock()

    async def duplicate_id_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container"}\n'
        yield '{"action": "add_node", "id": "vpc", "label": "VPC Duplicate", "category": "network", "node_type": "container"}\n'

    with patch("agents.architect.async_stream_text", duplicate_id_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_child_node_with_nonexistent_parent_id():
    """A node with parent_id referencing a node not yet emitted must be rejected."""
    mock_ws = AsyncMock()

    async def orphan_child_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service", "parent_id": "nonexistent_parent"}\n'

    with patch("agents.architect.async_stream_text", orphan_child_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_subnet_cannot_be_direct_child_of_vpc():
    """Subnet containers must be emitted under an AZ, not directly under a VPC."""
    mock_ws = AsyncMock()

    async def invalid_subnet_parent_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
        yield '{"action": "add_node", "id": "subnet_a", "label": "Subnet A", "category": "network", "node_type": "container", "container_type": "subnet", "parent_id": "vpc"}\n'

    with patch("agents.architect.async_stream_text", invalid_subnet_parent_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1


@pytest.mark.asyncio
async def test_service_under_subnet_is_accepted():
    """Service nodes parented to a subnet should pass validation."""
    mock_ws = AsyncMock()

    async def valid_nested_service_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container", "container_type": "vpc"}\n'
        yield '{"action": "add_node", "id": "az_a", "label": "AZ A", "category": "network", "node_type": "container", "container_type": "az", "parent_id": "vpc"}\n'
        yield '{"action": "add_node", "id": "subnet_a", "label": "Subnet A", "category": "network", "node_type": "container", "container_type": "subnet", "parent_id": "az_a"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service", "parent_id": "subnet_a"}\n'

    with patch("agents.architect.async_stream_text", valid_nested_service_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 4
    assert len(warnings) == 0


@pytest.mark.asyncio
async def test_valid_event_passes_through():
    """A fully valid event must pass through without validation warnings."""
    mock_ws = AsyncMock()

    async def valid_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network", "node_type": "container"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service", "aws_service_code": "AmazonECS"}\n'
        yield '{"action": "add_edge", "from": "vpc", "to": "ecs", "label": "contains"}\n'

    with patch("agents.architect.async_stream_text", valid_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 3
    assert len(warnings) == 0


@pytest.mark.asyncio
async def test_valid_region_container_event():
    """Region container node with valid container_type=region must pass."""
    mock_ws = AsyncMock()

    async def region_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "us_east_1", "label": "US East 1", "category": "network", "node_type": "container", "container_type": "region"}\n'

    with patch("agents.architect.async_stream_text", region_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 0


@pytest.mark.asyncio
async def test_service_node_cannot_have_container_type():
    """Service nodes cannot have container_type field set."""
    mock_ws = AsyncMock()

    async def service_with_container_type_stream(*args, **kwargs):
        yield '{"action": "add_node", "id": "vpc", "label": "VPC", "category": "network"}\n'
        yield '{"action": "add_node", "id": "ecs", "label": "ECS", "category": "compute", "node_type": "service", "container_type": "subnet", "aws_service_code": "AmazonECS"}\n'

    with patch("agents.architect.async_stream_text", service_with_container_type_stream):
        with patch("agents.architect.asyncio.sleep", return_value=None):
            from agents.architect import stream_architecture
            await stream_architecture({}, mock_ws)

    calls = [json.loads(c.args[0]) for c in mock_ws.send_text.call_args_list]
    diagram_events = [p for p in calls if p.get("type") == "diagram_event"]
    warnings = [p for p in calls if p.get("type") == "pipeline_event" and p.get("event") == "validation_error"]
    assert len(diagram_events) == 1
    assert len(warnings) == 1
