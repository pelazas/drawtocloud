import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from generation_service import GenerationStartError


def test_normalize_regions_accepts_list():
    from ws_handler import _normalize_regions

    assert _normalize_regions({"regions": ["us-east-1", "eu-west-1"]}) == ["us-east-1", "eu-west-1"]


def test_normalize_regions_wraps_legacy_string():
    from ws_handler import _normalize_regions

    assert _normalize_regions({"region": "eu-west-1"}) == ["eu-west-1"]


def test_normalize_regions_defaults_when_missing():
    from ws_handler import _normalize_regions

    assert _normalize_regions({}) == []


def test_ws_connects(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        pass


def test_ws_invalid_json(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text("not valid json")
        data = json.loads(ws.receive_text())
    assert data["type"] == "error"
    assert data["error"] == "invalid_json"


def test_ws_unknown_message_type(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "bogus"}))
        data = json.loads(ws.receive_text())
    assert data["type"] == "error"
    assert "unknown message type" in data["error"]


def test_ws_requires_access_token(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "chat", "message": "hello"}))
        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unauthenticated"


def test_ws_rejects_invalid_token(ws_client):
    with patch("ws_handler.verify_access_token_user", return_value=None):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "message": "hello",
                "access_token": "bad-token",
            }))
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "invalid_token"


def test_ws_start_generation_emits_project_ready_and_generation_started(ws_client):
    result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
        "created_project": True,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="admin@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=result)) as mock_start:
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(json.dumps({
                        "type": "start_generation",
                        "answers": {"app_name": "My App"},
                        "access_token": "test-token",
                    }))
                    project_ready = json.loads(ws.receive_text())
                    started = json.loads(ws.receive_text())

    assert project_ready == {
        "type": "project_ready",
        "project_id": "project-123",
        "share_slug": "abcd1234",
    }
    assert started["type"] == "generation_started"
    assert started["project_id"] == "project-123"
    assert started["trace_id"] == "trace-123"
    assert started["generation_status"] == "queued"
    mock_start.assert_awaited_once_with(
        "user-123",
        "admin@example.com",
        {"app_name": "My App", "regions": []},
        None,
        client_ip="testclient",
    )


def test_ws_start_generation_surfaces_start_errors(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch(
            "ws_handler.start_generation_for_user",
            new=AsyncMock(side_effect=GenerationStartError("quota_exhausted", "No quota left")),
        ):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "start_generation",
                    "answers": {"app_name": "My App"},
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "quota_exhausted"
    assert data["message"] == "No quota left"


def test_ws_subscribe_project_returns_generation_snapshot(ws_client):
    row = {
        "id": "project-1",
        "project_mode": "discovery",
        "terraform_files": [{"filename": "main.tf", "content": "resource \"aws_vpc\" \"main\" {}", "description": ""}],
        "generation_status": "running",
        "generation_stage": "architect",
        "generation_error": None,
        "generation_trace_id": "trace-1",
        "generation_started_at": "2026-03-13T10:00:00Z",
        "generation_completed_at": None,
        "last_event_at": "2026-03-13T10:00:10Z",
        "setup_pdf_status": "generating",
        "setup_pdf_progress": 25,
        "setup_pdf_error": None,
        "setup_pdf_generated_at": None,
        "setup_pdf_source_revision": None,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=row):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()) as mock_subscribe:
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(json.dumps({
                        "type": "subscribe_project",
                        "project_id": "project-1",
                        "access_token": "test-token",
                    }))
                    data = json.loads(ws.receive_text())

    assert data["type"] == "generation_snapshot"
    assert data["project_id"] == "project-1"
    assert data["project_mode"] == "discovery"
    assert isinstance(data["terraform_files"], list)
    assert data["terraform_files"][0]["filename"] == "main.tf"
    assert data["generation_status"] == "running"
    assert data["generation_stage"] == "architect"
    assert data["setup_pdf_status"] == "generating"
    assert data["setup_pdf_progress"] == 25
    mock_subscribe.assert_awaited_once()


def test_ws_chat_streams_reply_and_persists_history(ws_client):
    async def mock_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        assert message == "hello"
        assert isinstance(history, list)
        assert project_state["id"] == "project-123"
        assert selected_node_ids == []
        yield "Hello "
        yield "from assistant"

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
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history") as mock_append:
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "hello",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        events = []
                        while True:
                            event = json.loads(ws.receive_text())
                            events.append(event)
                            if event["type"] in ("chat_reply_done", "error"):
                                break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "Hello from assistant"
    assert mock_append.call_count == 2
    mock_append.assert_any_call("project-123", "user-123", "user", "hello", metadata=None)
    mock_append.assert_any_call(
        "project-123",
        "user-123",
        "assistant",
        "Hello from assistant",
        metadata={"execution_mode": "chat_only"},
    )


def test_ws_chat_forwards_selected_node_ids_to_chat_agent(ws_client):
    async def mock_chat_stream(message, history, project_state, selected_node_ids=None, llm_creds=None):
        assert message == "what does this do?"
        assert isinstance(history, list)
        assert project_state["id"] == "project-123"
        assert selected_node_ids == ["alb", "rds"]
        yield "Scoped response"

    project_row = {
        "id": "project-123",
        "nodes": [
            {"id": "alb", "data": {"label": "Application Load Balancer", "category": "network"}},
            {"id": "rds", "data": {"label": "Primary RDS", "category": "database"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()) as mock_append:
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "what does this do?",
                            "project_id": "project-123",
                            "selected_node_ids": ["alb", "rds"],
                            "access_token": "test-token",
                        }))
                        events = []
                        while True:
                            event = json.loads(ws.receive_text())
                            events.append(event)
                            if event["type"] in ("chat_reply_done", "error"):
                                break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "Scoped response"
    mock_append.assert_any_call(
        "project-123",
        "user-123",
        "user",
        "what does this do?",
        metadata={
            "selected_nodes": [
                {"id": "alb", "label": "Application Load Balancer", "category": "network"},
                {"id": "rds", "label": "Primary RDS", "category": "database"},
            ],
        },
    )


def test_ws_chat_node_patch_returns_pending_plan_without_side_effects(ws_client):

    project_row = {
        "id": "project-123",
        "nodes": [
            {"id": "alb", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "ALB", "category": "network"}},
            {"id": "rds", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "RDS", "category": "database"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                    with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                        with patch(
                            "ws_handler.rerun_project_agents_for_user",
                            new=AsyncMock(return_value={"trace_id": "trace-123"}),
                        ) as mock_rerun:
                            with ws_client.websocket_connect("/ws") as ws:
                                ws.send_text(
                                    json.dumps(
                                        {
                                            "type": "chat",
                                            "message": "make this cheaper",
                                            "project_id": "project-123",
                                            "selected_node_ids": ["rds"],
                                            "access_token": "test-token",
                                        }
                                    )
                                )
                                event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "node_patch"
    assert event.get("plan_ready") is True
    assert isinstance(event.get("plan_meta"), dict)
    assert event["plan_meta"].get("type") == "node_patch"
    assert event["plan_meta"].get("status") == "pending"
    assert isinstance(event["plan_meta"].get("plan_id"), str)
    assert "approve" in event["message"].lower()
    assert event.get("mutation") is None
    mock_mutation.assert_not_awaited()
    mock_update.assert_not_awaited()
    mock_rerun.assert_not_awaited()


def test_ws_chat_plan_approve_node_patch_applies_diff_and_reruns(ws_client):
    from agents.mutation_schema import MutationPlan

    async def mock_mutation_agent(
        user_goal,
        project_state,
        selected_node_ids=None,
        history=None,
        llm_creds=None,
        user_constraints=None,
    ):
        assert user_goal == "make this cheaper"
        assert project_state["id"] == "project-123"
        assert selected_node_ids == ["rds"]
        assert isinstance(history, list)
        assert llm_creds is None
        assert isinstance(user_constraints, list)
        return MutationPlan.model_validate(
            {
                "assistant_message": "I switched the selected database node to a lower-cost profile.",
                "reasoning": "Lowering database tier reduces baseline monthly spend.",
                "diff": {
                    "edit_nodes": [{"id": "rds", "label": "RDS (cost-optimized)"}],
                },
            }
        )

    project_row = {
        "id": "project-123",
        "nodes": [
            {"id": "alb", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "ALB", "category": "network"}},
            {"id": "rds", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "RDS", "category": "database"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [
            {
                "role": "assistant",
                "content": "I prepared a change plan. Approve to apply it.",
                "execution_mode": "node_patch",
                "plan_meta": {
                    "plan_id": "plan-node-1",
                    "type": "node_patch",
                    "status": "pending",
                    "requested_change": "make this cheaper",
                    "selected_node_ids": ["rds"],
                },
            }
        ],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
                with patch("ws_handler.append_chat_history", new=AsyncMock()):
                    with patch("ws_handler.run_mutation_agent", mock_mutation_agent):
                        with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                            with patch(
                                "ws_handler.rerun_project_agents_for_user",
                                new=AsyncMock(return_value={"trace_id": "trace-123"}),
                            ) as mock_rerun:
                                with ws_client.websocket_connect("/ws") as ws:
                                    ws.send_text(
                                        json.dumps(
                                            {
                                                "type": "chat_plan_approve",
                                                "project_id": "project-123",
                                                "plan_id": "plan-node-1",
                                                "access_token": "test-token",
                                            }
                                        )
                                    )
                                    event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "node_patch"
    assert "re-running" in event["message"].lower()
    assert event["mutation"]["summary"]["nodes_edited"] == 1
    assert event["mutation"]["scope"] == "selected"
    assert event.get("plan_meta", {}).get("type") == "node_patch"
    assert event.get("plan_meta", {}).get("status") == "approved"
    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    updated_rds = next(node for node in updated_nodes if node["id"] == "rds")
    assert updated_rds["data"]["label"] == "RDS (cost-optimized)"
    mock_rerun.assert_awaited_once()


def test_ws_chat_node_patch_requires_approval_before_agent_rerun(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [
            {"id": "ec2_gpu_node_group", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "GPU Node Group", "category": "compute"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                    with patch("ws_handler.update_project_fields", new=AsyncMock()):
                        with patch("ws_handler.rerun_project_agents_for_user", new=AsyncMock(return_value={"trace_id": "trace-1"})) as mock_rerun:
                            with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                                with ws_client.websocket_connect("/ws") as ws:
                                    ws.send_text(
                                        json.dumps(
                                            {
                                                "type": "chat",
                                                "message": "change ec2_gpu_node_group from p3.2xlarge to g4dn.xlarge",
                                                "project_id": "project-123",
                                                "selected_node_ids": ["ec2_gpu_node_group"],
                                                "access_token": "test-token",
                                            }
                                        )
                                    )
                                    event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "node_patch"
    assert event.get("plan_ready") is True
    assert event.get("mutation") is None
    mock_mutation.assert_not_awaited()
    mock_rerun.assert_not_awaited()
    mock_start.assert_not_awaited()


def test_ws_chat_plan_request_bypasses_mutation_and_returns_plan_text(ws_client):
    async def mock_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        del history, project_state, selected_node_ids, llm_creds
        assert "plan" in message.lower()
        yield "Here is a concrete plan to reduce cost and simplify."

    project_row = {
        "id": "project-123",
        "nodes": [{"id": "eks_cluster", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "EKS", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(
                                json.dumps(
                                    {
                                        "type": "chat",
                                        "message": "provide a plan to reduce costs and change the architecture",
                                        "project_id": "project-123",
                                        "access_token": "test-token",
                                    }
                                )
                            )
                            events = []
                            while True:
                                event = json.loads(ws.receive_text())
                                events.append(event)
                                if event["type"] in ("chat_reply_done", "error"):
                                    break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_done"]
    assert "plan" in events[-1]["message"].lower()
    mock_mutation.assert_not_awaited()


def test_ws_chat_architecture_wide_request_returns_analysis_and_usage_question(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "eks_cluster", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "EKS", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": {
            "monthly_total": 290.0,
            "currency": "USD",
            "items": [
                {"node_id": "rds", "label": "RDS PostgreSQL", "cost": 140.0, "estimated": False},
                {"node_id": "eks_cluster", "label": "EKS Cluster", "cost": 90.0, "estimated": True},
                {"node_id": "nat", "label": "NAT Gateway", "cost": 35.0, "estimated": True},
            ],
        },
        "chat_history": [{"role": "user", "content": "Initial architecture request"}],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(
                                json.dumps(
                                    {
                                        "type": "chat",
                                        "message": "I want the whole architecture to be cheaper and more simple",
                                        "project_id": "project-123",
                                        "access_token": "test-token",
                                    }
                                )
                            )
                            event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert "highest monthly cost" in event["message"].lower()
    assert "requests per month" in event["message"].lower()
    assert "requirements -> architect -> cost analyst" not in event["message"].lower()
    assert event.get("plan_ready") is not True
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_meta") is None
    mock_mutation.assert_not_awaited()
    mock_start.assert_not_awaited()


def test_ws_chat_architecture_request_with_selected_node_returns_question_not_immediate_plan(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "secrets_manager", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "Secrets Manager", "category": "security"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(
                                json.dumps(
                                    {
                                        "type": "chat",
                                        "message": "re-do architecture without the secrets manager",
                                        "project_id": "project-123",
                                        "selected_node_ids": ["secrets_manager"],
                                        "access_token": "test-token",
                                    }
                                )
                            )
                            event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_ready") is not True
    assert event.get("plan_meta") is None
    assert "requests per month" in event["message"].lower()
    mock_mutation.assert_not_awaited()
    mock_start.assert_not_awaited()


def test_ws_chat_architecture_request_with_usage_context_returns_approvable_proposal(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "eks_cluster", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "EKS", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": {
            "monthly_total": 290.0,
            "currency": "USD",
            "items": [
                {"node_id": "rds", "label": "RDS PostgreSQL", "cost": 140.0, "estimated": False},
                {"node_id": "eks_cluster", "label": "EKS Cluster", "cost": 90.0, "estimated": True},
                {"node_id": "nat", "label": "NAT Gateway", "cost": 35.0, "estimated": True},
            ],
        },
        "chat_history": [],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                        with ws_client.websocket_connect("/ws") as ws:
                            ws.send_text(
                                json.dumps(
                                    {
                                        "type": "chat",
                                        "message": "Make this architecture cheaper for 4 million requests per month, 40k monthly active users, and 6 TB traffic",
                                        "project_id": "project-123",
                                        "access_token": "test-token",
                                    }
                                )
                            )
                            event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_ready") is True
    assert isinstance(event.get("plan_meta"), dict)
    assert event["plan_meta"].get("status") == "pending"
    assert "updated monthly pricing" in event["message"].lower()
    assert "option a" in event["message"].lower()
    assert "option b" in event["message"].lower()
    mock_mutation.assert_not_awaited()
    mock_start.assert_not_awaited()


def test_ws_chat_plan_approve_starts_full_pipeline_rerun(ws_client):
    pending_plan = {
        "plan_id": "plan-123",
        "type": "architecture_refactor",
        "status": "pending",
        "requested_change": "re-do architecture without secrets manager",
    }
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "eks_cluster", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "EKS", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [
            {"role": "assistant", "content": "plan", "execution_mode": "architecture_refactor", "plan_meta": pending_plan}
        ],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }
    rerun_result = {
        "project_id": "project-123",
        "share_slug": "slug",
        "trace_id": "trace-rerun",
        "generation_status": "queued",
        "created_project": False,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=rerun_result)) as mock_start:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "chat_plan_approve",
                                    "project_id": "project-123",
                                    "plan_id": "plan-123",
                                    "access_token": "test-token",
                                }
                            )
                        )
                        event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert "generating the updated architecture now" in event["message"].lower()
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_meta", {}).get("status") == "approved"
    mock_start.assert_awaited_once()


def test_ws_chat_plan_approve_uses_requested_change_when_no_pending_plan(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [{"id": "eks_cluster", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "EKS", "category": "compute"}}],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }
    rerun_result = {
        "project_id": "project-123",
        "share_slug": "slug",
        "trace_id": "trace-rerun",
        "generation_status": "queued",
        "created_project": False,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=rerun_result)) as mock_start:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "chat_plan_approve",
                                    "project_id": "project-123",
                                    "plan_id": "plan-123",
                                    "requested_change": "replace EKS with ECS and managed services",
                                    "access_token": "test-token",
                                }
                            )
                        )
                        event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert "generating the updated architecture now" in event["message"].lower()
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_meta", {}).get("status") == "approved"
    assert event.get("plan_meta", {}).get("requested_change") == "replace EKS with ECS and managed services"
    mock_start.assert_awaited_once()


def test_ws_chat_architecture_plan_includes_security_warning_for_insecure_secret_request(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "questionnaire_answers": {"app_name": "Demo", "regions": ["us-east-1"]},
        "generation_status": "completed",
        "generation_stage": "completed",
    }
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(
                        json.dumps(
                            {
                                "type": "chat",
                                "message": "remove secrets manager and store secrets in ec2",
                                "project_id": "project-123",
                                "access_token": "test-token",
                            }
                        )
                    )
                    event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_ready") is not True
    assert "security warning" in event["message"].lower()


def test_ws_chat_node_patch_returns_plan_meta_with_selected_scope(ws_client):
    project_row = {
        "id": "project-123",
        "nodes": [
            {"id": "ec2_gpu_node_group", "type": "service", "position": {"x": 0, "y": 0}, "data": {"label": "GPU Node Group", "category": "compute"}},
        ],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "completed",
        "generation_stage": "completed",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.run_mutation_agent", new=AsyncMock()) as mock_mutation:
                    with patch("ws_handler.update_project_fields", new=AsyncMock()):
                        with patch("ws_handler.rerun_project_agents_for_user", new=AsyncMock(return_value={"trace_id": "trace-1"})) as mock_rerun:
                            with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                                with ws_client.websocket_connect("/ws") as ws:
                                    ws.send_text(
                                        json.dumps(
                                            {
                                                "type": "chat",
                                                "message": "change ec2_gpu_node_group from p3.2xlarge to g4dn.xlarge",
                                                "project_id": "project-123",
                                                "selected_node_ids": ["ec2_gpu_node_group"],
                                                "access_token": "test-token",
                                            }
                                        )
                                    )
                                    event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("execution_mode") == "node_patch"
    assert event.get("plan_ready") is True
    assert event.get("mutation") is None
    assert event.get("plan_meta", {}).get("type") == "node_patch"
    assert event.get("plan_meta", {}).get("status") == "pending"
    assert event.get("plan_meta", {}).get("selected_node_ids") == ["ec2_gpu_node_group"]
    mock_mutation.assert_not_awaited()
    mock_rerun.assert_not_awaited()
    mock_start.assert_not_awaited()


def test_ws_chat_allows_projectless_messages_with_canvas_context(ws_client):
    async def mock_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        del llm_creds
        assert message == "hello"
        assert history == []
        assert selected_node_ids == []
        assert project_state.get("id") is None
        assert isinstance(project_state.get("nodes"), list)
        assert isinstance(project_state.get("edges"), list)
        assert len(project_state["nodes"]) == 1
        assert len(project_state["edges"]) == 1
        yield "Projectless "
        yield "response"

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.append_chat_history", new=AsyncMock()) as mock_append:
            with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(
                        json.dumps(
                            {
                                "type": "chat",
                                "message": "hello",
                                "nodes": [
                                    {
                                        "id": "vpc",
                                        "type": "service",
                                        "position": {"x": 0, "y": 0},
                                        "data": {"label": "VPC", "category": "network"},
                                    }
                                ],
                                "edges": [{"source": "vpc", "target": "alb"}],
                                "access_token": "test-token",
                            }
                        )
                    )
                    events = []
                    while True:
                        event = json.loads(ws.receive_text())
                        events.append(event)
                        if event["type"] in ("chat_reply_done", "error"):
                            break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_delta", "chat_reply_done"]
    assert all(event.get("project_id") is None for event in events)
    assert events[-1]["message"] == "Projectless response"
    assert events[-1]["execution_mode"] == "chat_only"
    mock_append.assert_not_awaited()


def test_ws_chat_projectless_architecture_request_returns_plan_without_persistence(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.append_chat_history", new=AsyncMock()) as mock_append:
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "chat",
                            "message": "I want the whole architecture to be cheaper and simpler",
                            "nodes": [],
                            "edges": [],
                            "access_token": "test-token",
                        }
                    )
                )
                event = json.loads(ws.receive_text())

    assert event["type"] == "chat_reply_done"
    assert event.get("project_id") is None
    assert event.get("execution_mode") == "architecture_refactor"
    assert event.get("plan_ready") is not True
    assert event.get("plan_meta") is None
    assert "requests per month" in event["message"].lower()
    mock_append.assert_not_awaited()


def test_ws_chat_returns_project_not_found_for_invalid_project(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", side_effect=RuntimeError("Project not found")):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "chat",
                    "message": "hello",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "project_not_found"


def test_ws_chat_allows_messages_when_generation_not_completed(ws_client):
    async def mock_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        del history, project_state, selected_node_ids, llm_creds
        assert message == "hello"
        yield "You can chat before completion."

    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "project_mode": "default",
        "questionnaire_answers": {"_mode": "chat_first", "app_name": "Demo"},
        "generation_status": "completed",
        "generation_stage": "architect",
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(json.dumps({
                        "type": "chat",
                        "message": "hello",
                        "project_id": "project-123",
                        "access_token": "test-token",
                    }))
                    events = []
                    while True:
                        event = json.loads(ws.receive_text())
                        events.append(event)
                        if event["type"] in ("chat_reply_done", "error"):
                            break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "You can chat before completion."


def test_ws_chat_returns_chat_failed_when_agent_raises(ws_client):
    async def broken_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        if False:
            yield ""
        raise RuntimeError("chat exploded")

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
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history") as mock_append:
                with patch("ws_handler.stream_chat_reply", broken_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "chat",
                            "message": "hello",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "chat_failed"
    # user message persisted, assistant message not persisted on failure
    assert mock_append.call_count == 1


def test_canvas_edit_remove_node_returns_ack_without_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
            {"id": "rds", "data": {"label": "RDS"}, "type": "default"},
        ],
        "edges": [
            {"id": "e1", "source": "vpc", "target": "rds"},
        ],
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "canvas_edit",
                            "action": "remove_node",
                            "id": "rds",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        data = json.loads(ws.receive_text())

    assert data["type"] == "canvas_edit_ack"
    assert data["project_id"] == "project-123"
    assert data["action"] == "remove_node"

    # update_project_fields must be called with rds node removed and its edge gone
    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    updated_edges = call_args[0][2]["edges"]
    assert not any(n["id"] == "rds" for n in updated_nodes)
    assert len(updated_edges) == 0

    mock_start.assert_not_awaited()


def test_canvas_edit_add_node_returns_ack_without_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
        ],
        "edges": [],
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "canvas_edit",
                            "action": "add_node",
                            "label": "Redis Cache",
                            "category": "database",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        data = json.loads(ws.receive_text())

    assert data["type"] == "canvas_edit_ack"
    assert data["project_id"] == "project-123"
    assert data["action"] == "add_node"

    assert mock_update.await_count >= 1
    first_call_args = mock_update.await_args_list[0]
    updated_nodes = first_call_args.args[2]["nodes"]
    assert len(updated_nodes) == 2
    new_node = next(n for n in updated_nodes if n["id"] != "vpc")
    assert new_node["data"]["label"] == "Redis Cache"
    assert new_node["data"]["category"] == "database"

    mock_start.assert_not_awaited()


def test_canvas_edit_rename_node_returns_ack_without_regen(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [
            {"id": "vpc", "data": {"label": "VPC"}, "type": "default"},
        ],
        "edges": [],
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.update_project_fields", new=AsyncMock()) as mock_update:
                with patch("ws_handler.start_generation_for_user", new=AsyncMock()) as mock_start:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(json.dumps({
                            "type": "canvas_edit",
                            "action": "rename_node",
                            "id": "vpc",
                            "label": "Main VPC",
                            "project_id": "project-123",
                            "access_token": "test-token",
                        }))
                        data = json.loads(ws.receive_text())

    assert data["type"] == "canvas_edit_ack"
    assert data["project_id"] == "project-123"
    assert data["action"] == "rename_node"

    mock_update.assert_awaited_once()
    call_args = mock_update.call_args
    updated_nodes = call_args[0][2]["nodes"]
    renamed = next(n for n in updated_nodes if n["id"] == "vpc")
    assert renamed["data"]["label"] == "Main VPC"

    mock_start.assert_not_awaited()


def test_canvas_edit_requires_project_id(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "canvas_edit",
                "action": "remove_node",
                "id": "vpc",
                "access_token": "test-token",
            }))
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "missing_project_id"


def test_canvas_edit_unknown_action_returns_error(ws_client):
    project_row = {
        "id": "project-123",
        "questionnaire_answers": {"app_name": "My App"},
        "nodes": [],
        "edges": [],
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(json.dumps({
                    "type": "canvas_edit",
                    "action": "teleport_node",
                    "project_id": "project-123",
                    "access_token": "test-token",
                }))
                data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unknown_canvas_action"


def test_generate_terraform_requires_access_token(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "generate_terraform", "project_id": "project-123"}))
        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unauthenticated"


def test_estimate_cost_requires_access_token(ws_client):
    with ws_client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "estimate_cost", "nodes": [{"id": "node-1"}]}))
        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "unauthenticated"


def test_estimate_cost_returns_missing_nodes_for_invalid_payloads(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    invalid_payloads = [
        {"type": "estimate_cost", "access_token": "test-token"},
        {"type": "estimate_cost", "nodes": [], "access_token": "test-token"},
        {"type": "estimate_cost", "nodes": "not-a-list", "access_token": "test-token"},
    ]

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            for payload in invalid_payloads:
                ws.send_text(json.dumps(payload))
                data = json.loads(ws.receive_text())
                assert data == {
                    "type": "error",
                    "error": "missing_nodes",
                    "message": "estimate_cost requires a non-empty nodes array.",
                }


def test_estimate_cost_emits_cost_estimate_when_analyst_returns_dict(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    raw_nodes = [{"id": "node-1", "data": {"label": "ALB", "category": "network"}}]
    estimate = {"region": "us-east-1", "monthly_total": 42.0, "items": []}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.run_cost_analyst", new=AsyncMock(return_value=estimate)) as mock_cost_analyst:
            with ws_client.websocket_connect("/ws") as ws:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "estimate_cost",
                            "nodes": raw_nodes,
                            "access_token": "test-token",
                        }
                    )
                )
                data = json.loads(ws.receive_text())

    assert data == {"type": "cost_estimate", **estimate}
    mock_cost_analyst.assert_awaited_once()
    call_kwargs = mock_cost_analyst.await_args.kwargs
    assert call_kwargs["nodes"] == raw_nodes
    assert call_kwargs["regions"] == []
    assert call_kwargs["project_id"] == ""
    assert isinstance(call_kwargs["runtime"], SimpleNamespace)
    assert call_kwargs["runtime"].client_ip == "testclient"


def test_generate_terraform_requires_project_id(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(
                json.dumps(
                    {
                        "type": "generate_terraform",
                        "access_token": "test-token",
                    }
                )
            )
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "missing_project_id"


def test_generate_terraform_rejects_empty_canvas(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    project_row = {"id": "project-123", "nodes": [], "edges": []}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", new=AsyncMock(return_value=project_row)):
            with patch("ws_handler.rerun_project_agents_for_user", new=AsyncMock()) as mock_rerun:
                with ws_client.websocket_connect("/ws") as ws:
                    ws.send_text(
                        json.dumps(
                            {
                                "type": "generate_terraform",
                                "project_id": "project-123",
                                "access_token": "test-token",
                            }
                        )
                    )
                    data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "no_diagram_nodes"
    mock_rerun.assert_not_awaited()


def test_generate_terraform_queues_coder_rerun(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    project_row = {"id": "project-123", "nodes": [{"id": "vpc"}], "edges": []}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", new=AsyncMock(return_value=project_row)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()) as mock_subscribe:
                with patch(
                    "ws_handler.rerun_project_agents_for_user",
                    new=AsyncMock(return_value={"trace_id": "trace-rerun"}),
                ) as mock_rerun:
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "generate_terraform",
                                    "project_id": "project-123",
                                    "access_token": "test-token",
                                }
                            )
                        )
    mock_subscribe.assert_awaited_once()
    assert mock_subscribe.await_args.args[0] == "project-123"
    mock_rerun.assert_awaited_once_with(
        user_id="user-123",
        user_email="user@example.com",
        project_id="project-123",
        agent_names=["coder"],
    )


def test_generate_terraform_surfaces_generation_start_error(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    project_row = {"id": "project-123", "nodes": [{"id": "vpc"}], "edges": []}

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", new=AsyncMock(return_value=project_row)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                with patch(
                    "ws_handler.rerun_project_agents_for_user",
                    new=AsyncMock(side_effect=GenerationStartError("quota_exhausted", "No quota left")),
                ):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "generate_terraform",
                                    "project_id": "project-123",
                                    "access_token": "test-token",
                                }
                            )
                        )
                        data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert data["error"] == "quota_exhausted"
    assert data["message"] == "No quota left"


def test_chat_discovery_start_is_rejected_as_unknown_message(ws_client):
    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with ws_client.websocket_connect("/ws") as ws:
            ws.send_text(
                json.dumps(
                    {
                        "type": "chat_discovery_start",
                        "app_name": "Demo",
                        "regions": ["us-east-1"],
                        "expected_users": "1K–100K/mo",
                        "uptime": "99.9% SLA",
                        "access_token": "test-token",
                    }
                )
            )
            data = json.loads(ws.receive_text())

    assert data["type"] == "error"
    assert "unknown message type" in data["error"]


def test_chat_allows_non_completed_generation_for_existing_projects(ws_client):
    async def mock_chat_stream(
        message,
        history,
        project_state,
        selected_node_ids=None,
        llm_creds=None,
    ):
        del history, project_state, selected_node_ids, llm_creds
        assert message == "Not sure yet"
        yield "We can still iterate on this design."

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    project_row = {
        "id": "project-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "generation_status": "idle",
        "generation_stage": "queued",
        "project_mode": "discovery",
        "questionnaire_answers": {"app_name": "Demo"},
    }

    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.get_project_for_user", return_value=project_row):
            with patch("ws_handler.append_chat_history", new=AsyncMock()):
                with patch("ws_handler.stream_chat_reply", mock_chat_stream):
                    with ws_client.websocket_connect("/ws") as ws:
                        ws.send_text(
                            json.dumps(
                                {
                                    "type": "chat",
                                    "message": "Not sure yet",
                                    "project_id": "project-123",
                                    "access_token": "test-token",
                                }
                            )
                        )
                        events = []
                        while True:
                            event = json.loads(ws.receive_text())
                            events.append(event)
                            if event["type"] in ("chat_reply_done", "error"):
                                break

    assert [event["type"] for event in events] == ["chat_reply_delta", "chat_reply_done"]
    assert events[-1]["message"] == "We can still iterate on this design."


def test_ws_start_generation_does_not_send_after_close():
    from ws_handler import handle_websocket

    class ClosingWebSocket:
        def __init__(self) -> None:
            self._received = False
            self.send_attempts = 0

        async def receive_text(self) -> str:
            if self._received:
                raise RuntimeError("client disconnected")
            self._received = True
            return json.dumps(
                {
                    "type": "start_generation",
                    "answers": {"app_name": "My App"},
                    "access_token": "test-token",
                }
            )

        async def send_text(self, payload: str) -> None:
            self.send_attempts += 1
            raise RuntimeError('Cannot call "send" once a close message has been sent.')

    websocket = ClosingWebSocket()

    result = {
        "project_id": "project-123",
        "share_slug": "abcd1234",
        "trace_id": "trace-123",
        "generation_status": "queued",
        "created_project": True,
    }

    auth_user = SimpleNamespace(user_id="user-123", email="user@example.com")
    with patch("ws_handler.verify_access_token_user", return_value=auth_user):
        with patch("ws_handler.start_generation_for_user", new=AsyncMock(return_value=result)):
            with patch("ws_handler.subscribe_websocket", new=AsyncMock()):
                asyncio.run(handle_websocket(websocket))

    assert websocket.send_attempts >= 1
