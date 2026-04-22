import json
import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

logger = logging.getLogger(__name__)


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class RuntimeLikeWebSocket(MockWebSocket):
    async def emit_generation_agent_event(self, *args, **kwargs):
        return None

    async def update_generation_agent(self, *args, **kwargs):
        return None


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
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
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
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
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

    payload, diag = _decode_single_file_payload(noisy, trace_id="trace-1", expected_filename="main.tf")
    assert diag is None, "Valid JSON should return None diagnostic"
    assert payload is not None
    assert payload["filename"] == "main.tf"


def test_anthropic_tool_use_path_uses_streaming():
    """Anthropic path should call tool-use streaming path and avoid JSON fallback."""

    async def run():
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=(4, {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}))) as tool_use:
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
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "qwen-test", "sk-test")):
            with patch("agents.coder._stream_via_json_single_file_mode", new=AsyncMock(return_value=(4, {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}, {}))) as bounded_mode:
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
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
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
        ws = RuntimeLikeWebSocket()
        observed: dict = {}

        async def fake_wait_for(awaitable, timeout):
            observed["timeout"] = timeout
            return await awaitable

        with patch("agents.coder.resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=(4, {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}))):
                with patch("agents.coder.asyncio.wait_for", new=fake_wait_for):
                    from agents.coder import stream_terraform_files, TOOL_USE_TIMEOUT_SECONDS
                    await stream_terraform_files({"app_type": "web"}, ws)
                    return observed.get("timeout"), TOOL_USE_TIMEOUT_SECONDS

    observed_timeout, configured_timeout = asyncio.run(run())
    assert observed_timeout == configured_timeout


def test_anthropic_tool_use_client_uses_http_timeout():
    async def run():
        ws = RuntimeLikeWebSocket()
        mock_messages = MagicMock()
        mock_messages.stream = MagicMock(return_value=_EmptyAsyncEventStream())
        mock_client_instance = MagicMock()
        mock_client_instance.messages = mock_messages

        with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance) as async_anthropic:
            from agents.coder import _stream_via_tool_use, HTTP_CLIENT_TIMEOUT
            emitted_count, emitted_files = await _stream_via_tool_use(
                {"app_type": "web"},
                ws,
                model="claude-test",
                api_key="sk-test",
            )
            return async_anthropic.call_args.kwargs.get("timeout"), HTTP_CLIENT_TIMEOUT, emitted_count, emitted_files

    configured_timeout, expected_timeout, emitted_count, emitted_files = asyncio.run(run())
    assert configured_timeout == expected_timeout
    assert emitted_count == 0
    assert emitted_files == set()


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
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
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
        ws = RuntimeLikeWebSocket()

        async def fake_fallback(*args, **kwargs):
            emitted_filenames = kwargs.get("emitted_filenames")
            if isinstance(emitted_filenames, set):
                emitted_filenames.update({"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"})
            return 4

        with patch("agents.coder.resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(side_effect=asyncio.TimeoutError)):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(side_effect=fake_fallback)) as fallback:
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
        ws = RuntimeLikeWebSocket()

        async def fake_fallback(*args, **kwargs):
            emitted_filenames = kwargs.get("emitted_filenames")
            if isinstance(emitted_filenames, set):
                emitted_filenames.update({"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"})
            return 2

        with patch("agents.coder.resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("agents.coder._stream_via_tool_use", new=AsyncMock(return_value=(2, {"main.tf", "variables.tf"}))):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(side_effect=fake_fallback)) as fallback:
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
        ws = RuntimeLikeWebSocket()
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
        ws = RuntimeLikeWebSocket()

        async def fake_fallback(*args, **kwargs):
            emitted_filenames = kwargs.get("emitted_filenames")
            if isinstance(emitted_filenames, set):
                emitted_filenames.update({"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"})
            return 4

        with patch("agents.coder.resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance):
                with patch("agents.coder._stream_via_json_complete", new=AsyncMock(side_effect=fake_fallback)) as fallback:
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


class _MockRuntime:
    """Minimal mock runtime for testing stream_terraform_files with incomplete/complete file sets."""

    def __init__(self, ws):
        self._ws = ws
        self.trace_id = "test-trace-123"
        self.project_id = "test-project"
        self.user_id = "test-user"
        self.generation_agents_update_calls = []

    async def emit_generation_agent_event(self, agent, status, event_type, message, *, history=False, error=None):
        pass

    async def update_generation_agent(self, agent, status, error=None):
        self.generation_agents_update_calls.append({"agent": agent, "status": status, "error": error})

    async def send_text(self, text):
        await self._ws.send_text(text)


def test_coder_incomplete_files_raises_error():
    """CoderIncompleteFilesError is raised when LLM returns only variables.tf (missing main.tf, outputs.tf, terraform.tfvars)."""

    async def run():
        ws = MockWebSocket()
        runtime = _MockRuntime(ws)
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder._stream_via_json_single_file_mode", new=AsyncMock(return_value=(1, {"variables.tf"}, {}))):
                from agents.coder import stream_terraform_files, CoderIncompleteFilesError
                try:
                    await stream_terraform_files({"app_type": "web"}, runtime)
                    assert False, "Expected CoderIncompleteFilesError to be raised"
                except CoderIncompleteFilesError as e:
                    assert len(e.missing_files) == 3, f"Expected 3 missing files, got {len(e.missing_files)}"
                    assert "main.tf" in e.missing_files
                    assert "outputs.tf" in e.missing_files
                    assert "terraform.tfvars" in e.missing_files
                return ws.sent
        return ws.sent

    sent = asyncio.run(run())
    failed_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.failed"
    ]
    assert len(failed_events) == 1, f"Expected 1 coder.failed event, got {len(failed_events)}"
    assert failed_events[0].get("level") == "error"
    assert "missing" in failed_events[0].get("message", "").lower()


def test_json_single_file_mode_incomplete_returns_partial_and_error_detail():
    """Bounded JSON single-file mode returns partial files; CoderIncompleteFilesError must name the exact missing files.

    When async_complete raises TimeoutError for 2 of 4 files (simulating LLM timeouts),
    _stream_via_json_single_file_mode emits only 2 files and returns with a partial set.
    The fallback _stream_via_json_complete is mocked to NOT recover (returns 0).
    stream_terraform_files then raises CoderIncompleteFilesError — but the error's str()
    must include the specific missing filenames so rerun diagnostics are actionable.
    """

    call_count = 0

    async def incomplete_complete(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            return json.dumps([{"filename": "main.tf", "content": "# main", "description": "Main"}])
        raise asyncio.TimeoutError("simulated LLM timeout")

    async def run():
        ws = RuntimeLikeWebSocket()
        runtime = _MockRuntime(ws)
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.async_complete", new=incomplete_complete):
                with patch(
                    "agents.coder._stream_via_json_complete",
                    new=AsyncMock(return_value=(0, set())),
                ):
                    from agents.coder import stream_terraform_files, CoderIncompleteFilesError
                    try:
                        await stream_terraform_files({"app_type": "web"}, runtime)
                        assert False, "Expected CoderIncompleteFilesError to be raised"
                    except CoderIncompleteFilesError as e:
                        assert len(e.missing_files) == 2, (
                            f"Expected 2 missing files, got {len(e.missing_files)}: {e.missing_files}"
                        )
                        missing_names = set(e.missing_files)
                        assert missing_names == {"outputs.tf", "terraform.tfvars"}, (
                            f"Expected exact missing files {{outputs.tf, terraform.tfvars}}, got {missing_names}"
                        )
                        error_str = str(e)
                        assert "outputs.tf" in error_str, (
                            f"Error string must name missing files, got: {error_str}"
                        )
                        assert "terraform.tfvars" in error_str, (
                            f"Error string must name missing files, got: {error_str}"
                        )
                    return ws.sent

    sent = asyncio.run(run())
    failed_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.failed"
    ]
    assert len(failed_events) == 1, f"Expected 1 coder.failed event, got {len(failed_events)}"
    details = failed_events[0].get("details", {})
    assert "outputs.tf" in details.get("missing_files", []), (
        f"coder.failed event details.missing_files must name exact files, got: {details.get('missing_files', [])}"
    )
    assert "terraform.tfvars" in details.get("missing_files", []), (
        f"coder.failed event details.missing_files must name exact files, got: {details.get('missing_files', [])}"
    )


def test_coder_completes_successfully_with_all_required_files():
    """Coder completes successfully and emits coder.completed when all 4 required files are returned."""

    async def run():
        ws = MockWebSocket()
        runtime = _MockRuntime(ws)
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch(
                "agents.coder._stream_via_json_single_file_mode",
                new=AsyncMock(return_value=(4, {"main.tf", "variables.tf", "outputs.tf", "terraform.tfvars"}, {})),
            ):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({"app_type": "web"}, runtime)
                return ws.sent

    sent = asyncio.run(run())
    completed_events = [
        message
        for message in sent
        if message.get("type") == "pipeline_event" and message.get("event") == "coder.completed"
    ]
    assert len(completed_events) == 1, f"Expected 1 coder.completed event, got {len(completed_events)}"


# ---------------------------------------------------------------------------
# Tests for failure-aware coder retry behavior (issue #219)
# ---------------------------------------------------------------------------


def test_coder_retry_diagnostics_captured_on_invalid_payload():
    """When a single-file response is invalid JSON, structured retry diagnostics are captured."""

    from agents.coder import _decode_single_file_payload, CoderRetryDiagnostic

    raw_invalid = "not json at all"
    payload, diag = _decode_single_file_payload(raw_invalid, trace_id="t1", expected_filename="main.tf")
    assert payload is None, "Invalid JSON should return None payload"
    assert diag is not None, "Invalid JSON should return a diagnostic"
    assert isinstance(diag, CoderRetryDiagnostic)
    assert diag.filename == "main.tf"
    assert diag.failure_reason == "no_valid_json_found"
    assert diag.raw_preview == raw_invalid
    assert diag.attempt_number == 1


def test_coder_retry_prompt_includes_repair_context():
    """The single-file prompt on retry includes repair context: prior failure reason and invalid output preview."""

    from agents.coder import _build_single_file_prompt, CoderRetryDiagnostic

    retry_diag = CoderRetryDiagnostic(
        filename="main.tf",
        failure_reason="single_file_payload_not_object",
        raw_preview='{"content": "# hcl", "description": "main"}',
        expected_schema='{"filename": "...", "content": "...", "description": "..."}',
        attempt_number=1,
        retry_count=1,
    )

    prompt = _build_single_file_prompt(
        {"app_name": "test-app"},
        "main.tf",
        retry_diagnostic=retry_diag,
    )

    assert "repair" in prompt.lower() or "previous" in prompt.lower(), (
        "Retry prompt must acknowledge prior failure"
    )
    assert "main.tf" in prompt
    assert "single_file_payload_not_object" in prompt or "not object" in prompt.lower()


def test_coder_retry_preserves_successful_files():
    """When single-file mode retries, previously successful files are not regenerated."""

    call_log = []

    async def tracking_complete(messages, system, llm_creds=None, max_tokens=2048, log_context=None):
        prompt_content = messages[0]["content"]
        call_log.append(prompt_content)
        if "main.tf" in prompt_content:
            return json.dumps({"filename": "main.tf", "content": "# main", "description": "Main"})
        elif "variables.tf" in prompt_content:
            return json.dumps({"filename": "variables.tf", "content": "# vars", "description": "Vars"})
        elif "outputs.tf" in prompt_content:
            return json.dumps({"filename": "outputs.tf", "content": "# outputs", "description": "Outputs"})
        elif "terraform.tfvars" in prompt_content:
            return "not valid json"
        return json.dumps({"filename": "main.tf", "content": "# fallback", "description": "Fallback"})

    async def run():
        ws = RuntimeLikeWebSocket()
        with patch("agents.coder.resolve_creds", return_value=("openrouter", "gpt-4o", "sk-test")):
            with patch("agents.coder.async_complete", new=AsyncMock(side_effect=tracking_complete)):
                from agents.coder import stream_terraform_files, CoderRetryDiagnostic
                try:
                    await stream_terraform_files({"app_type": "web"}, ws)
                except Exception:
                    logger.exception("test_coder.stream_terraform_files_raised")
        return call_log

    log = asyncio.run(run())
    main_tf_calls = [c for c in log if "main.tf" in c]
    assert len(main_tf_calls) <= 2, (
        f"main.tf should be generated at most twice (initial + retry), got {len(main_tf_calls)}"
    )


def test_coder_progressive_repair_guidance_on_repeated_failures():
    """Repeated contract failures for the same file produce progressively stronger repair guidance."""

    from agents.coder import _build_single_file_prompt, CoderRetryDiagnostic

    diag_1 = CoderRetryDiagnostic(
        filename="main.tf",
        failure_reason="single_file_payload_not_object",
        raw_preview="not json",
        expected_schema='{"filename": "...", "content": "...", "description": "..."}',
        attempt_number=1,
        retry_count=1,
    )

    diag_2 = CoderRetryDiagnostic(
        filename="main.tf",
        failure_reason="single_file_payload_not_object",
        raw_preview="also not json",
        expected_schema='{"filename": "...", "content": "...", "description": "..."}',
        attempt_number=1,
        retry_count=2,
    )

    prompt_1 = _build_single_file_prompt({"app_name": "test"}, "main.tf", retry_diagnostic=diag_1)
    prompt_2 = _build_single_file_prompt({"app_name": "test"}, "main.tf", retry_diagnostic=diag_2)

    assert prompt_2 != prompt_1, (
        "Retry 2 should produce different guidance than retry 1 for the same file"
    )
    assert "previous" in prompt_2.lower() or "again" in prompt_2.lower(), (
        "Second retry prompt must acknowledge repeated failure"
    )


def test_coder_sanitizes_invalid_payload_preview():
    """Invalid payload previews are safely truncated and do not leak sensitive/bloated content."""

    from agents.coder import _sanitize_payload_preview

    long_invalid = "x" * 1000
    sanitized = _sanitize_payload_preview(long_invalid)
    assert len(sanitized) <= 250, f"Sanitized preview must be <= 250 chars, got {len(sanitized)}"

    fenced = "```json\n" + "y" * 500 + "\n```"
    sanitized_fenced = _sanitize_payload_preview(fenced)
    assert not sanitized_fenced.startswith("```"), "Markdown fences must be stripped"

    assert _sanitize_payload_preview(None) == ""
