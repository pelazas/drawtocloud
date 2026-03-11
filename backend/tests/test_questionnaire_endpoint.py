import pytest
import json
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch


@pytest.mark.asyncio
async def test_questionnaire_sse_format():
    async def mock_generate(answers):
        yield {"id": "q4", "prompt": "Traffic?", "type": "single_select", "options": ["low", "high"], "allow_custom": False}
        yield {"id": "q5", "prompt": "Region?", "type": "single_select", "options": ["us-east-1", "eu-west-1"], "allow_custom": False}
        yield {"id": "q6", "prompt": "Notes?", "type": "free_text", "options": None, "allow_custom": False}

    with patch("agents.questionnaire.generate_followup_questions", mock_generate):
        from main import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/questionnaire",
                json={"answers": {"app_type": "Web app", "stage": "MVP", "team_size": "Solo founder"}},
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        lines = [l for l in response.text.split("\n") if l.startswith("data: ")]
        assert lines[-1] == 'data: {"done": true}'
        for line in lines[:-1]:
            payload = json.loads(line[len("data: "):])
            assert "question" in payload
