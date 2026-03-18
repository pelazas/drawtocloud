import asyncio
import json
from unittest.mock import AsyncMock, patch


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def test_description_timeout_emits_pipeline_event():
    async def run():
        ws = MockWebSocket()
        with patch("agents.description.async_complete", new=AsyncMock(side_effect=asyncio.TimeoutError())):
            from agents.description import run_description_agent
            await run_description_agent({"app_type": "web"}, ws)
        return ws.sent

    sent = asyncio.run(run())
    event = next(
        m for m in sent
        if m.get("type") == "pipeline_event" and m.get("stage") == "description" and m.get("event") == "timeout"
    )
    assert event["level"] == "warning"
