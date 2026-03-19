import json
from unittest.mock import patch

import pytest


class MockWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


@pytest.mark.asyncio
async def test_emit_log_includes_structured_fields_and_trace_id():
    from agents.log_helper import emit_log

    ws = MockWebSocket()

    with patch("agents.log_helper.time.time", return_value=105.0):
        await emit_log(
            ws,
            "coder",
            "Terraform ready",
            start_time=100.0,
            trace_id="trace-123",
        )

    assert len(ws.sent) == 1
    payload = ws.sent[0]
    assert payload["type"] == "agent_log"
    assert payload["agent"] == "coder"
    assert payload["message"] == "Terraform ready"
    assert payload["trace_id"] == "trace-123"
    assert payload["duration_ms"] == 5000
    assert payload["elapsed"] == 5.0
