import json
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def test_json_fallback_path():
    """OpenRouter path: async_complete returns JSON array, sends terraform_file messages."""
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
    assert len(terraform_messages) == 2
    assert terraform_messages[0]["filename"] == "main.tf"
    assert terraform_messages[1]["filename"] == "variables.tf"


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
    assert len(terraform_messages) == 1
    assert terraform_messages[0]["filename"] == "main.tf"


def test_anthropic_tool_use_path_uses_streaming():
    """Anthropic path: uses streaming API (not blocking create) and emits terraform files."""
    mock_block = MagicMock()
    mock_block.type = "tool_use"
    mock_block.name = "emit_terraform_file"
    mock_block.input = {
        "filename": "main.tf",
        "content": "# content",
        "description": "Main Terraform file",
    }

    mock_response = MagicMock()
    mock_response.stop_reason = "end_turn"
    mock_response.content = [mock_block]

    mock_stream_ctx = AsyncMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_stream_ctx.get_final_message = AsyncMock(return_value=mock_response)

    mock_messages = MagicMock()
    mock_messages.stream = MagicMock(return_value=mock_stream_ctx)
    mock_messages.create = AsyncMock(return_value=mock_response)

    mock_client_instance = MagicMock()
    mock_client_instance.messages = mock_messages

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder._resolve_creds", return_value=("anthropic", "claude-test", "sk-test")):
            with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    assert len(terraform_messages) == 1
    assert terraform_messages[0]["filename"] == "main.tf"
    assert terraform_messages[0]["content"] == "# content"
    mock_messages.stream.assert_called_once()
    mock_messages.create.assert_not_called()


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
    """Timeout constants must be >= 120s to handle slow LLM responses (issue #37)."""
    from agents.coder import PRIMARY_REQUEST_TIMEOUT_SECONDS, FALLBACK_REQUEST_TIMEOUT_SECONDS
    assert PRIMARY_REQUEST_TIMEOUT_SECONDS >= 120, (
        f"PRIMARY_REQUEST_TIMEOUT_SECONDS={PRIMARY_REQUEST_TIMEOUT_SECONDS} is too short, must be >= 120"
    )
    assert FALLBACK_REQUEST_TIMEOUT_SECONDS >= 120, (
        f"FALLBACK_REQUEST_TIMEOUT_SECONDS={FALLBACK_REQUEST_TIMEOUT_SECONDS} is too short, must be >= 120"
    )


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
