from unittest.mock import AsyncMock, patch

import pytest

import generation_service
from generation_service import GenerationStartError


class _FakeTask:
    def done(self) -> bool:
        return False


class _FakePersistence:
    def __init__(self) -> None:
        self.nodes: list = []


class _FakeRuntime:
    def __init__(self, is_admin: bool) -> None:
        self.user_id = "user-123"
        self.project_id = "project-123"
        self.is_admin = is_admin
        self.persistence = _FakePersistence()

    async def set_generation_state(self, **kwargs):
        return None

    async def emit_pipeline_event(self, *args, **kwargs):
        return None

    async def send_text(self, payload: str):
        return None

    async def persist_partial_state(self):
        return None


@pytest.fixture(autouse=True)
def _reset_generation_state():
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()
    yield
    generation_service._RUNNING_TASKS.clear()
    generation_service._RUNTIMES.clear()


@pytest.mark.asyncio
async def test_admin_start_generation_skips_quota_exhaustion():
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=True):
        with patch("generation_service.get_user_quota") as mock_quota:
            with patch(
                "generation_service.create_project_for_generation",
                return_value={"id": "project-123", "share_slug": "slug-123"},
            ):
                with patch("generation_service.update_project_fields"):
                    with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                        result = await generation_service.start_generation_for_user(
                            "user-123",
                            "admin@example.com",
                            {"app_name": "Demo"},
                        )

    mock_quota.assert_not_called()
    assert result["project_id"] == "project-123"
    assert result["generation_status"] == "queued"


@pytest.mark.asyncio
async def test_non_admin_start_generation_still_enforces_quota():
    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.get_user_quota",
            return_value={"generations_used": 5, "generations_limit": 5},
        ):
            with pytest.raises(GenerationStartError) as error:
                await generation_service.start_generation_for_user(
                    "user-123",
                    "user@example.com",
                    {"app_name": "Demo"},
                )

    assert error.value.code == "quota_exhausted"


@pytest.mark.asyncio
async def test_run_generation_does_not_increment_for_admin():
    runtime = _FakeRuntime(is_admin=True)

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=AsyncMock(return_value=None)):
            with patch("generation_service.stream_terraform_files", new=AsyncMock(return_value=None)):
                with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                    with patch("generation_service.run_description_agent", new=AsyncMock(return_value=None)):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            with patch("generation_service.increment_generations_used") as mock_increment:
                                await generation_service._run_generation(runtime, {"app_name": "Demo"})

    mock_increment.assert_not_called()


@pytest.mark.asyncio
async def test_run_generation_increments_for_non_admin():
    runtime = _FakeRuntime(is_admin=False)

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=AsyncMock(return_value=None)):
            with patch("generation_service.stream_terraform_files", new=AsyncMock(return_value=None)):
                with patch("generation_service.run_cost_analyst", new=AsyncMock(return_value=None)):
                    with patch("generation_service.run_description_agent", new=AsyncMock(return_value=None)):
                        with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                            with patch("generation_service.increment_generations_used") as mock_increment:
                                await generation_service._run_generation(runtime, {"app_name": "Demo"})

    mock_increment.assert_called_once_with("user-123")
