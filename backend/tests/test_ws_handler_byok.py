import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def test_ws_chat_passes_byok_credentials_to_chat_agent(ws_client):
    observed_llm_creds = []

    async def mock_chat_stream(message, history, project_state, llm_creds=None):
        observed_llm_creds.append(llm_creds)
        yield "hello"

    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    byok = {"provider": "anthropic", "api_key": "sk-test", "model": None}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.get_user_llm_key", new=AsyncMock(return_value=byok)):
                with patch("ws_handler.append_chat_history"):
                    with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(
                                json.dumps(
                                    {
                                        "type": "chat",
                                        "message": "hello",
                                        "project_id": "project-123",
                                        "access_token": "test-token",
                                    }
                                )
                            )
                            while True:
                                event = json.loads(ws.receive_text())
                                if event["type"] == "chat_reply_done":
                                    break

    assert observed_llm_creds == [byok]
