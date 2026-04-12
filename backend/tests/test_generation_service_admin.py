from unittest.mock import AsyncMock, patch

import pytest

import generation_service
from generation_service import GenerationStartError

SUFFICIENT_ANSWERS = {
    "app_name": "Demo",
    "description": "A multi-tenant analytics SaaS with auth, dashboard queries, and background jobs.",
}


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
        self.trace_id = "trace-test-123"
        self.is_admin = is_admin
        self.persistence = _FakePersistence()
        self._generation_observability: list | None = None

    def init_generation_observability(self) -> None:
        self._generation_observability = generation_service._init_generation_observability()

    async def update_generation_agent(
        self,
        agent_name: str,
        status: str,
        *,
        error: str | None = None,
    ) -> None:
        if not self._generation_observability:
            return
        generation_service._update_generation_agent(
            self._generation_observability,
            agent_name,
            status,
            error=error,
        )

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
async def test_admin_start_generation_skips_quota():
    """Admin users must bypass check_and_reserve_quota entirely."""
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=True):
        with patch("generation_service.check_and_reserve_quota") as mock_quota:
            with patch(
                "generation_service.create_project_for_generation",
                return_value={"id": "project-123", "share_slug": "slug-123"},
            ):
                with patch("generation_service.update_project_fields"):
                    with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                        result = await generation_service.start_generation_for_user(
                            "user-123",
                            "admin@example.com",
                            SUFFICIENT_ANSWERS,
                        )

    mock_quota.assert_not_called()
    assert result["project_id"] == "project-123"
    assert result["generation_status"] == "queued"


@pytest.mark.asyncio
async def test_non_admin_start_generation_still_enforces_quota():
    """Non-admin without BYOK must be rejected when check_and_reserve_quota reports exhausted."""
    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.check_and_reserve_quota",
            new=AsyncMock(return_value={"ok": False, "error": "quota_exhausted", "generations_used": 5, "generations_limit": 5}),
        ):
            with pytest.raises(GenerationStartError) as error:
                await generation_service.start_generation_for_user(
                    "user-123",
                    "user@example.com",
                    SUFFICIENT_ANSWERS,
                )

    assert error.value.code == "quota_exhausted"


@pytest.mark.asyncio
async def test_non_admin_profile_not_found_raises_quota_check_failed():
    """profile_not_found from the RPC must surface as quota_check_failed, not quota_exhausted."""
    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.check_and_reserve_quota",
            new=AsyncMock(return_value={"ok": False, "error": "profile_not_found", "generations_used": 0, "generations_limit": 0}),
        ):
            with pytest.raises(GenerationStartError) as error:
                await generation_service.start_generation_for_user(
                    "user-123",
                    "user@example.com",
                    SUFFICIENT_ANSWERS,
                )

    assert error.value.code == "quota_check_failed"


@pytest.mark.asyncio
async def test_run_generation_does_not_touch_quota():
    """_run_generation must not call check_and_reserve_quota or increment_generations_used.

    Quota is now reserved atomically in start_generation_for_user before the
    generation task is created.  _run_generation is quota-agnostic.
    """
    runtime = _FakeRuntime(is_admin=True)

    with patch("generation_service.generate_requirements", new=AsyncMock(return_value={})):
        with patch("generation_service.stream_architecture", new=AsyncMock(return_value=None)):
            with patch("generation_service.stream_terraform_files", new=AsyncMock(return_value=None)):
                with patch("generation_service.run_description_agent", new=AsyncMock(return_value=None)):
                    with patch("generation_service.emit_log", new=AsyncMock(return_value=None)):
                        with patch("generation_service.check_and_reserve_quota") as mock_reserve:
                            await generation_service._run_generation(runtime, {"app_name": "Demo"})

    mock_reserve.assert_not_called()


@pytest.mark.asyncio
async def test_start_generation_reserves_quota_for_non_admin():
    """check_and_reserve_quota must be called once for a non-admin without BYOK."""
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=False):
        with patch(
            "generation_service.check_and_reserve_quota",
            new=AsyncMock(return_value={"ok": True, "error": None, "generations_used": 3, "generations_limit": 5}),
        ) as mock_reserve:
            with patch(
                "generation_service.create_project_for_generation",
                return_value={"id": "project-123", "share_slug": "slug-123"},
            ):
                with patch("generation_service.update_project_fields"):
                    with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                        await generation_service.start_generation_for_user(
                            "user-123",
                            "user@example.com",
                            SUFFICIENT_ANSWERS,
                        )

    mock_reserve.assert_called_once_with("user-123")


@pytest.mark.asyncio
async def test_start_generation_rejects_insufficient_context_before_side_effects():
    """Insufficient context must be blocked before quota/project side effects."""
    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    with patch("generation_service.is_admin_email", return_value=False):
        with patch("generation_service.get_user_llm_key", new=AsyncMock(return_value=None)):
            with patch(
                "generation_service.check_and_reserve_quota",
                new=AsyncMock(return_value={"ok": True, "error": None, "generations_used": 0, "generations_limit": 5}),
            ) as mock_reserve:
                with patch(
                    "generation_service.create_project_for_generation",
                    new=AsyncMock(return_value={"id": "project-123", "share_slug": "slug-123"}),
                ) as mock_create:
                    with patch("generation_service.update_project_fields", new=AsyncMock()):
                        with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                            with pytest.raises(GenerationStartError) as error:
                                await generation_service.start_generation_for_user(
                                    "user-123",
                                    "user@example.com",
                                    {"app_name": "Demo"},
                                )

    assert error.value.code == "insufficient_context"
    mock_reserve.assert_not_called()
    mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_start_generation_allows_discovery_approved_answers():
    """Approved discovery payloads should bypass insufficient-context gating."""

    def fake_create_task(coro):
        coro.close()
        return _FakeTask()

    approved_answers = {
        "app_name": "Demo",
        "conversation_summary": "User: Multi-tenant SaaS with auth, file uploads, background workers, and S3 backups.",
        "_approved_plan": "true",
    }

    with patch("generation_service.is_admin_email", return_value=False):
        with patch("generation_service.get_user_llm_key", new=AsyncMock(return_value=None)):
            with patch(
                "generation_service.check_and_reserve_quota",
                new=AsyncMock(return_value={"ok": True, "error": None, "generations_used": 1, "generations_limit": 5}),
            ):
                with patch(
                    "generation_service.create_project_for_generation",
                    return_value={"id": "project-123", "share_slug": "slug-123"},
                ):
                    with patch("generation_service.update_project_fields"):
                        with patch("generation_service.asyncio.create_task", side_effect=fake_create_task):
                            result = await generation_service.start_generation_for_user(
                                "user-123",
                                "user@example.com",
                                approved_answers,
                            )

    assert result["project_id"] == "project-123"
