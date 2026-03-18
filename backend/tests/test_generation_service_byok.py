from unittest.mock import AsyncMock, patch

import pytest

import generation_service

SUFFICIENT_ANSWERS = {
    "app_name": "Demo",
    "description": "A collaborative design platform with auth, realtime updates, and scheduled background processing.",
}


class _FakeTask:
    def done(self) -> bool:
        return False


@pytest.fixture(autouse=True)
def _reset_generation_state():
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()
    yield
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()


@pytest.mark.asyncio
async def test_non_admin_start_generation_skips_quota_when_byok_present():
    """BYOK users must bypass check_and_reserve_quota regardless of admin status."""
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.get_user_llm_key",
            new=AsyncMock(return_value={"provider": "anthropic", "api_key": "sk-test", "model": None}),
        ):
            with patch("generation_service.check_and_reserve_quota") as mock_quota:
                with patch(
                    "generation_service.create_project_for_generation",
                    return_value={"id": "project-123", "share_slug": "slug-123"},
                ):
                    with patch("generation_service.update_project_fields"):
                        with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                            result = await generation_service.start_generation_for_user(
                                "user-123",
                                "user@example.com",
                                SUFFICIENT_ANSWERS,
                            )

    mock_quota.assert_not_called()
    assert result["project_id"] == "project-123"


@pytest.mark.asyncio
async def test_start_generation_sets_project_mode_default_for_new_project():
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.get_user_llm_key",
            new=AsyncMock(return_value={"provider": "anthropic", "api_key": "sk-test", "model": None}),
        ):
            with patch(
                "generation_service.create_project_for_generation",
                return_value={"id": "project-123", "share_slug": "slug-123"},
            ):
                with patch("generation_service.update_project_fields", new=AsyncMock()) as mock_update:
                    with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                        await generation_service.start_generation_for_user(
                            "user-123",
                            "user@example.com",
                            SUFFICIENT_ANSWERS,
                        )

    update_payloads = [call.args[2] for call in mock_update.await_args_list]
    assert any(payload.get("project_mode") == "default" for payload in update_payloads)


@pytest.mark.asyncio
async def test_start_generation_sets_project_mode_default_for_existing_project():
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    existing_row = {
        "id": "project-123",
        "share_slug": "slug-123",
        "nodes": [],
        "edges": [],
        "terraform_files": [],
        "cost_estimate": None,
        "chat_history": [],
        "description": None,
    }

    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.get_user_llm_key",
            new=AsyncMock(return_value={"provider": "anthropic", "api_key": "sk-test", "model": None}),
        ):
            with patch(
                "generation_service.get_project_for_user",
                new=AsyncMock(side_effect=[existing_row, existing_row]),
            ):
                with patch("generation_service.create_project_for_generation", new=AsyncMock()) as mock_create:
                    with patch("generation_service.update_project_fields", new=AsyncMock()) as mock_update:
                        with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                            await generation_service.start_generation_for_user(
                                "user-123",
                                "user@example.com",
                                SUFFICIENT_ANSWERS,
                                "project-123",
                            )

    mock_create.assert_not_awaited()
    update_payloads = [call.args[2] for call in mock_update.await_args_list]
    assert any(payload.get("project_mode") == "default" for payload in update_payloads)


@pytest.mark.asyncio
async def test_run_generation_passes_llm_creds_for_byok():
    """_run_generation must forward llm_creds to agents when present."""
    class _Runtime:
        def __init__(self) -> None:
            self.user_id = "user-123"
            self.project_id = "project-123"
            self.trace_id = "trace-123"
            self.is_admin = False
            self.llm_creds = {"provider": "openai", "api_key": "sk", "model": None}
            self.persistence = type("P", (), {"nodes": []})()

        async def set_generation_state(self, **kwargs):
            return None

        async def emit_pipeline_event(self, *args, **kwargs):
            return None

        async def send_text(self, payload: str):
            return None

        async def persist_partial_state(self):
            return None

    runtime = _Runtime()

    req_kwargs: dict = {}
    arch_kwargs: dict = {}

    async def _requirements(*args, **kwargs):
        req_kwargs.update(kwargs)
        return {}

    async def _architect(*args, **kwargs):
        arch_kwargs.update(kwargs)
        return None

    with patch("generation_service.generate_requirements", new=_requirements):
        with patch("generation_service.stream_architecture", new=_architect):
            with patch("generation_service.stream_terraform_files", new=AsyncMock(return_value=None)):
                with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                    with patch("generation_service.run_description_agent", new=AsyncMock(return_value=None)):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    assert req_kwargs.get("llm_creds") == runtime.llm_creds
    assert arch_kwargs.get("llm_creds") == runtime.llm_creds
