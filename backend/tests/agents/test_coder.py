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
    assert len(sent) == 2
    assert all(m["type"] == "terraform_file" for m in sent)
    assert sent[0]["filename"] == "main.tf"
    assert sent[1]["filename"] == "variables.tf"


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
    assert len(sent) == 1
    assert sent[0]["type"] == "terraform_file"
    assert sent[0]["filename"] == "main.tf"


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
    assert len(sent) == 1
    assert sent[0]["type"] == "terraform_file"
    assert sent[0]["filename"] == "main.tf"
    assert sent[0]["content"] == "# content"
