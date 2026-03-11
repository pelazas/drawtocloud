import pytest
import json
from unittest.mock import patch


@pytest.mark.asyncio
async def test_generate_followup_questions():
    mock_response = json.dumps({
        "questions": [
            {"id": "q4", "prompt": "Expected traffic?", "type": "single_select",
             "options": ["< 1k/day", "1k-100k/day", "100k+/day"], "allow_custom": False},
            {"id": "q5", "prompt": "Primary database?", "type": "single_select",
             "options": ["PostgreSQL", "MySQL", "DynamoDB"], "allow_custom": True},
            {"id": "q6", "prompt": "Describe your data model", "type": "free_text",
             "options": None, "allow_custom": False},
        ]
    })

    async def mock_stream(*args, **kwargs):
        yield mock_response

    with patch("llm_client.async_stream_text", mock_stream):
        from agents.questionnaire import generate_followup_questions
        questions = []
        async for q in generate_followup_questions({"app_type": "Web app", "stage": "MVP", "team_size": "Solo founder"}):
            questions.append(q)

    assert len(questions) >= 3
    for q in questions:
        assert "id" in q
        assert "prompt" in q
        assert "type" in q
        assert "options" in q
        assert "allow_custom" in q
