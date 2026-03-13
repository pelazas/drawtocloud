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
        with patch("agents.coder.ACTIVE_PROVIDER", "openrouter"):
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
        with patch("agents.coder.ACTIVE_PROVIDER", "openrouter"):
            with patch("agents.coder.async_complete", new=AsyncMock(return_value=files_json)):
                from agents.coder import stream_terraform_files
                await stream_terraform_files({}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    assert len(terraform_messages) == 1
    assert terraform_messages[0]["filename"] == "main.tf"


def test_anthropic_tool_use_path():
    """Anthropic path: tool_use blocks are sent as terraform_file messages."""
    mock_block = MagicMock()
    mock_block.type = "tool_use"
    mock_block.name = "emit_terraform_file"
    mock_block.input = {
        "filename": "main.tf",
        "content": "# content",
        "description": "Main Terraform file",
    }

    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_messages = AsyncMock()
    mock_messages.create = AsyncMock(return_value=mock_response)

    mock_client_instance = MagicMock()
    mock_client_instance.messages = mock_messages

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder.ACTIVE_PROVIDER", "anthropic"):
            with patch("agents.coder.ACTIVE_MODEL", "claude-test"):
                with patch("agents.coder.ACTIVE_KEY", "sk-test"):
                    with patch("anthropic.AsyncAnthropic", return_value=mock_client_instance):
                        from agents.coder import stream_terraform_files
                        await stream_terraform_files({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    terraform_messages = [message for message in sent if message.get("type") == "terraform_file"]
    assert len(terraform_messages) == 1
    assert terraform_messages[0]["filename"] == "main.tf"
    assert terraform_messages[0]["content"] == "# content"


def test_emits_coder_pipeline_progress_events():
    files_json = json.dumps([
        {"filename": "main.tf", "content": "# main", "description": "Main config"},
        {"filename": "variables.tf", "content": "# vars", "description": "Variables"},
    ])

    async def run():
        ws = MockWebSocket()
        with patch("agents.coder.ACTIVE_PROVIDER", "openrouter"):
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


def test_timeout_triggers_json_fallback():
    async def run():
        ws = MockWebSocket()
        with patch("agents.coder.ACTIVE_PROVIDER", "anthropic"):
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
