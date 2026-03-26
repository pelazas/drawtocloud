import pytest
from unittest.mock import patch


def test_build_chat_system_prompt_includes_project_context():
    from agents.chat_agent import build_chat_system_prompt

    project_state = {
        "id": "project-123",
        "nodes": [{"id": "alb", "data": {"label": "ALB"}}],
        "edges": [{"id": "alb-ecs", "source": "alb", "target": "ecs"}],
        "terraform_files": [{"filename": "main.tf", "content": "resource \"aws_lb\" \"app\" {}"}],
        "cost_estimate": {"monthly_total": 42, "currency": "USD", "line_items": []},
        "description": "{\"overview\":\"A simple architecture.\"}",
    }

    prompt = build_chat_system_prompt(project_state)

    assert "Read-only mode" in prompt
    assert "main.tf" in prompt
    assert "monthly_total" in prompt
    assert "ALB" in prompt


def test_build_chat_system_prompt_includes_cost_optimization_guidance():
    from agents.chat_agent import build_chat_system_prompt

    project_state = {
        "nodes": [{"id": "api", "data": {"label": "API Gateway", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": {"monthly_total": 120, "currency": "USD", "items": [{"label": "API Gateway", "cost": 40}]},
        "description": None,
    }

    prompt = build_chat_system_prompt(project_state)

    assert "If user asks to make the architecture cheaper" in prompt
    assert "requests per month" in prompt
    assert "monthly active users" in prompt
    assert "monthly traffic" in prompt


def test_build_chat_system_prompt_summarizes_items_cost_breakdown():
    from agents.chat_agent import build_chat_system_prompt

    project_state = {
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": {
            "monthly_total": 200,
            "currency": "USD",
            "items": [
                {"label": "RDS PostgreSQL", "cost": 120},
                {"label": "API Gateway", "cost": 40},
            ],
        },
        "description": None,
    }

    prompt = build_chat_system_prompt(project_state)

    assert "RDS PostgreSQL" in prompt
    assert "API Gateway" in prompt


def test_build_chat_system_prompt_includes_selection_scope_when_selected_nodes_present():
    from agents.chat_agent import build_chat_system_prompt

    project_state = {
        "nodes": [
            {"id": "alb", "data": {"label": "Application Load Balancer", "category": "network"}},
            {"id": "rds", "data": {"label": "RDS PostgreSQL", "category": "database"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "description": None,
    }

    prompt = build_chat_system_prompt(project_state, selected_node_ids=["alb"])

    assert "SELECTED NODES" in prompt
    selected_section = prompt.split("SELECTED NODES", 1)[1]
    assert "Application Load Balancer" in selected_section
    assert "Scope your answer to these nodes" in prompt
    assert "RDS PostgreSQL" not in selected_section


def test_is_mutation_intent_detects_cost_optimization_prompt():
    from agents.chat_agent import is_mutation_intent

    assert is_mutation_intent("make this cheaper by switching to smaller instances") is True


def test_is_mutation_intent_ignores_read_only_question():
    from agents.chat_agent import is_mutation_intent

    assert is_mutation_intent("what does this architecture currently do?") is False


@pytest.mark.asyncio
async def test_stream_chat_reply_uses_history_and_question():
    captured = {}

    async def fake_stream(messages, system, llm_creds=None):
        captured["messages"] = messages
        captured["system"] = system
        yield "Hello"
        yield " world"

    history = [{"role": "user", "content": "What do we have?"}]
    project_state = {
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "description": None,
    }

    with patch("agents.chat_agent.async_stream_text", fake_stream):
        from agents.chat_agent import stream_chat_reply

        chunks = [chunk async for chunk in stream_chat_reply("Tell me about HA", history, project_state)]

    assert chunks == ["Hello", " world"]
    assert captured["messages"][-1] == {"role": "user", "content": "Tell me about HA"}
    assert "Read-only mode" in captured["system"]


@pytest.mark.asyncio
async def test_stream_chat_reply_includes_selection_scope_in_system_prompt():
    captured = {}

    async def fake_stream(messages, system, llm_creds=None):
        captured["messages"] = messages
        captured["system"] = system
        yield "Scoped"

    history = [{"role": "user", "content": "How is this node configured?"}]
    project_state = {
        "nodes": [
            {"id": "ecs", "data": {"label": "ECS Service", "category": "compute"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "description": None,
    }

    with patch("agents.chat_agent.async_stream_text", fake_stream):
        from agents.chat_agent import stream_chat_reply

        chunks = [
            chunk
            async for chunk in stream_chat_reply(
                "Explain selected components",
                history,
                project_state,
                selected_node_ids=["ecs"],
            )
        ]

    assert chunks == ["Scoped"]
    assert captured["messages"][-1] == {"role": "user", "content": "Explain selected components"}
    assert "SELECTED NODES" in captured["system"]
    assert "ECS Service" in captured["system"]
