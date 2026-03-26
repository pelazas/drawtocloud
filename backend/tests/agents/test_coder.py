import json
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class _EmptyAsyncEventStream:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


def test_json_fallback_path():
    """OpenRouter path uses bounded file generation and emits only required Terraform files."""
    files_json = json.dumps([
        {"filename": "main.tf", "content": "# main", "description": "Main config"},
        {"filename": "variables.tf", "content": "# vars", "description": "Variables"},
    ])

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.async_complete", new=AsyncMock(return_value=files_json)):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    terraform_filenames = {message["filename"] for message in terraform_messages}
    assert terraform_filenames == {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}


def test_json_fallback_strips_markdown_fences():
    """Fenced JSON is unwrapped before parsing."""
    files_json = '```json\n[{"filename": "main.tf", "content": "# tf", "description": "main"}]\n```'

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.async_complete", new=AsyncMock(return_value=files_json)):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    terraform_filenames = {message["filename"] for message in terraform_messages}
    assert terraform_filenames == {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}


def test_decode_single_file_payload_recovers_from_trailing_content():
    noisy = '{"filename":"main.tf","content":"# main","description":"Main"}\nextra trailing notes'
    from agents.coder import _decode_single_file_payload

    payload = _decode_single_file_payload(noisy, trace_id="trace-1", expected_filename="main.tf")
    assert payload is not None
    assert payload["filename"] == "main.tf"


def test_anthropic_tool_use_path_uses_streaming():
    """Anthropic path should call tool-use streaming path and avoid JSON fallback."""

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=4)) as tool_use:
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(return_value=0)) as fallback:
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return ws.sent, tool_use.await_count, fallback.await_count

    sent, tool_use_count, fallback_count = asyncio.run(run())
    assert tool_use_count == 1
    assert fallback_count == 0
    completed_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.completed"
    ]
    assert len(completed_events) == 1


def test_non_anthropic_path_uses_bounded_json_mode():
    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("openrouter", "qwen-test", "sk-test")):
            with patch("agents.coder._stream_via_json_single_file_mode", new=AsyncMock(return_value=4)) as bounded_mode:
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(return_value=0)) as json_complete:
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return bounded_mode.await_count, json_complete.await_count

    bounded_count, complete_count = asyncio.run(run())
    assert bounded_count == 1
    assert complete_count == 0


def test_emits_coder_pipeline_progress_events():
    files_json = json.dumps([
        {"filename": "main.tf", "content": "# main", "description": "Main config"},
        {"filename": "variables.tf", "content": "# vars", "description": "Variables"},
    ])

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.async_complete", new=AsyncMock(return_value=files_json)):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    coder_events = [
        message["event"]
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("stage") == "coder"
    ]
    assert "coder.started" in coder_events
    assert "coder.llm_request_started" in coder_events
    assert "coder.first_file_emitted" in coder_events
    assert "coder.file_emitted" in coder_events
    assert "coder.completed" in coder_events


def test_max_tokens_sufficient_for_terraform():
    """ANTHROPIC_MAX_TOKENS must be >= 16384 to avoid truncation (issue #73)."""
    from agents.coder import ANTHROPIC_MAX_TOKENS
    assert ANTHROPIC_MAX_TOKENS >= 16384, (
        f"ANTHROPIC_MAX_TOKENS={ANTHROPIC_MAX_TOKENS} is too low, must be >= 16384"
    )


def test_timeout_constants_are_sufficient():
    """Timeout constants must be >= 180s to handle slow LLM responses (issue #126)."""
    from agents.coder import TOOL_USE_TIMEOUT_SECONDS, FALLBACK_REQUEST_TIMEOUT_SECONDS
    assert TOOL_USE_TIMEOUT_SECONDS >= 180, (
        f"TOOL_USE_TIMEOUT_SECONDS={TOOL_USE_TIMEOUT_SECONDS} is too short, must be >= 180"
    )
    assert FALLBACK_REQUEST_TIMEOUT_SECONDS >= 180, (
        f"FALLBACK_REQUEST_TIMEOUT_SECONDS={FALLBACK_REQUEST_TIMEOUT_SECONDS} is too short, must be >= 180"
    )


def test_tool_use_path_applies_inner_timeout():
    async def run():
        ws = MockWebSocket()
        observed: dict = {}

        async def fake_wait_for(awaitable, timeout):
            observed["timeout"] = timeout
            return await awaitable

        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=4)):
                with patch("agents.coder.asyncio.wait_for", new=fake_wait_for):
                    from agents.coder import stream_terraform_files, TOOL_USE_TIMEOUT_SECONDS
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return observed.get("timeout"), TOOL_USE_TIMEOUT_SECONDS

    observed_timeout, configured_timeout = asyncio.run(run())
    assert observed_timeout == configured_timeout


def test_anthropic_tool_use_client_uses_http_timeout():
    async def run():
        ws = MockWebSocket()
        mock_messages = MagicMock()
        mock_messages.stream = MagicMock(return_value=_EmptyAsyncEventStream())
        mock_client_instance = MagicMock()
        mock_client_instance.messages = mock_messages

        with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance) as async_anthropic:
            from agents.coder import _stream_via_tool_use, HTTP_CLIENT_TIMEOUT
            emitted_count = await _stream_via_tool_use(
                {"app_type": "web"},
                ws,
                model="claude-test",
                api_key="sk-test",
            )
            return async_anthropic.call_args.kwargs.get("timeout"), HTTP_CLIENT_TIMEOUT, emitted_count

    configured_timeout, expected_timeout, emitted_count = asyncio.run(run())
    assert configured_timeout == expected_timeout
    assert emitted_count == 0


def test_json_fallback_does_not_timeout_on_slow_response():
    """Slow but healthy async_complete must not raise TimeoutError (issue #37)."""

    async def slow_complete(*args, **kwargs):
        await asyncio.sleep(0.3)  # simulates slow LLM response
        return json.dumps([
            {"filename": "main.tf", "content": "# main", "description": "Main"},
            {"filename": "variables.tf", "content": "# vars", "description": "Vars"},
            {"filename": "outputs.tf", "content": "# outs", "description": "Outs"},
            {"filename": "terraform.tfvars", "content": "# tfvars", "description": "Tfvars"},
        ])

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.FALLBACK_REQUEST_TIMEOUT_SECONDS", 1):
                with patch("agents.coder.async_complete", new=slow_complete):
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [m for m in sent if m.get("type") == "terraform_file"]
    assert len(terraform_messages) == 4


def test_timeout_triggers_json_fallback():
    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(side_effect=asyncio.TimeoutError)):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(return_value=1)) as fallback:
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
                return ws.sent, fallback.await_count

    sent, fallback_await_count = asyncio.run(run())
    assert fallback_await_count == 1
    fallback_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.timeout_fallback"
    ]
    assert len(fallback_events) >= 1


def test_partial_tool_use_output_triggers_json_fallback():
    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=2)):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(return_value=4)) as fallback:
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return fallback.await_count

    fallback_count = asyncio.run(run())
    assert fallback_count == 1


def test_json_complete_filters_disallowed_filenames():
    files_json = (
        "The files are below:\n"
        + json.dumps([
            {"filename": "main.tf", "content": "# main", "description": "Main config"},
            {"filename": ".gitignore", "content": "*.tfstate", "description": "Ignore"},
            {"filename": "templates/user_data.sh.tpl", "content": "#!/bin/bash", "description": "userdata"},
            {"filename": "variables.tf", "content": "# vars", "description": "Vars"},
        ])
        + "\nDone."
    )

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder.async_complete", new=AsyncMock(return_value=files_json)):
            from agents.coder import _stream_via_json_complete
            await _stream_via_json_complete({"app_type": "web"}, ws)
            return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    terraform_filenames = [message.get("filename") for message in terraform_messages]
    assert ".gitignore" not in terraform_filenames
    assert "templates/user_data.sh.tpl" not in terraform_filenames
    assert "main.tf" in terraform_filenames
    assert "variables.tf" in terraform_filenames


def test_truncated_tool_use_falls_back_to_json():
    """When tool-use response is truncated (stop_reason=max_tokens), JSON fallback is used."""
    mock_response = MagicMock()
    mock_response.stop_reason = "max_tokens"
    mock_response.content = []

    mock_stream_ctx = AsyncMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_stream_ctx.get_final_message = AsyncMock(return_value=mock_response)

    mock_messages = MagicMock()
    mock_messages.stream = MagicMock(return_value=mock_stream_ctx)

    mock_client_instance = MagicMock()
    mock_client_instance.messages = mock_messages

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(return_value=4)) as fallback:
                    from agents.coder import stream_terraform_files
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return ws.sent, fallback.await_count

    sent, fallback_count = asyncio.run(run())
    assert fallback_count == 1, f"Expected 1 fallback call, got {fallback_count}"
    fallback_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.parse_fallback"
    ]
    assert len(fallback_events) == 1, f"Expected 1 parse_fallback event, got {len(fallback_events)}"
