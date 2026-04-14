import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from postgrest.exceptions import APIError
import project_store


def _mock_chain(data):
    chain = MagicMock()
    response = MagicMock()
    response.data = data
    chain.execute.return_value = response

    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.in_.return_value = chain
    chain.single.return_value = chain
    chain.insert.return_value = chain
    chain.update.return_value = chain

    return chain


def test_derive_project_title_prefers_app_name():
    title = project_store.derive_project_title({"app_name": "  Billing API  ", "description": "ignored"})
    assert title == "Billing API"


def test_derive_project_title_falls_back_to_untitled():
    title = project_store.derive_project_title({"empty": []})
    assert title == "Untitled Project"


async def test_create_project_for_generation_retries_on_duplicate_slug():
    insert_chain = _mock_chain([{"id": "p1", "share_slug": "slug0002"}])

    with patch("project_store._generate_slug", side_effect=["slug0001", "slug0002"]):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.side_effect = [
                Exception("duplicate key value violates unique constraint projects_share_slug_key"),
                insert_chain,
            ]
            mock_supabase.table.return_value = insert_table

            row = await project_store.create_project_for_generation("user-1", {"app_name": "Demo"})

    assert row["id"] == "p1"
    assert row["share_slug"] == "slug0002"


async def test_create_project_for_generation_sets_default_project_mode():
    insert_chain = _mock_chain([{"id": "p1", "share_slug": "slug0001"}])

    with patch("project_store._generate_slug", return_value="slug0001"):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.return_value = insert_chain
            mock_supabase.table.return_value = insert_table

            await project_store.create_project_for_generation("user-1", {"app_name": "Demo"})

    payload = insert_table.insert.call_args.args[0]
    assert payload["project_mode"] == "default"


async def test_create_named_project_retries_on_duplicate_slug():
    insert_chain = _mock_chain([{"id": "p2", "share_slug": "slug0002", "title": "My App"}])

    with patch("project_store._generate_slug", side_effect=["slug0001", "slug0002"]):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.side_effect = [
                Exception("duplicate key value violates unique constraint projects_share_slug_key"),
                insert_chain,
            ]
            mock_supabase.table.return_value = insert_table

            row = await project_store.create_named_project("user-1", "My App")

    assert row["id"] == "p2"
    assert row["share_slug"] == "slug0002"


async def test_create_named_project_sets_idle_defaults_and_title():
    insert_chain = _mock_chain([{"id": "p2", "share_slug": "slug0001", "title": "My Project"}])

    with patch("project_store._generate_slug", return_value="slug0001"):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.return_value = insert_chain
            mock_supabase.table.return_value = insert_table

            await project_store.create_named_project("user-1", "   My Project   ")

    payload = insert_table.insert.call_args.args[0]
    assert payload["title"] == "My Project"
    assert payload["project_mode"] == "default"
    assert payload["questionnaire_answers"] == {}
    assert payload["nodes"] == []
    assert payload["edges"] == []
    assert payload["terraform_files"] == []
    assert payload["chat_history"] == []
    assert payload["cost_estimate"] is None
    assert payload["generation_status"] == "idle"
    assert payload["generation_stage"] is None
    assert payload["generation_error"] is None
    assert payload["generation_trace_id"] is None
    assert payload["generation_started_at"] is None
    assert payload["generation_completed_at"] is None
    assert payload["last_event_at"] is None
    assert payload["setup_pdf_status"] == "none"
    assert payload["setup_pdf_url"] is None
    assert payload["setup_pdf_storage_path"] is None
    assert payload["setup_pdf_generated_at"] is None
    assert payload["setup_pdf_source_revision"] is None
    assert payload["setup_pdf_error"] is None
    assert payload["setup_pdf_progress"] == 0


async def test_create_named_project_maps_whitespace_name_to_untitled_project():
    insert_chain = _mock_chain([{"id": "p3", "share_slug": "slug0003", "title": "Untitled Project"}])

    with patch("project_store._generate_slug", return_value="slug0003"):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.return_value = insert_chain
            mock_supabase.table.return_value = insert_table

            await project_store.create_named_project("user-1", "   \n\t  ")

    payload = insert_table.insert.call_args.args[0]
    assert payload["title"] == "Untitled Project"


async def test_create_named_project_falls_back_to_fetch_when_insert_returns_no_row():
    insert_chain = _mock_chain([])
    fetched_chain = _mock_chain({"id": "p2", "share_slug": "slug0001", "title": "Fetched Project"})

    with patch("project_store._generate_slug", return_value="slug0001"):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.return_value = insert_chain
            mock_supabase.table.side_effect = [insert_table, fetched_chain]

            row = await project_store.create_named_project("user-1", "Fetched Project")

    assert row == {"id": "p2", "share_slug": "slug0001", "title": "Fetched Project"}
    fetched_chain.select.assert_called_once_with("id, share_slug, title")
    assert fetched_chain.eq.call_count == 2


async def test_create_named_project_raises_after_max_slug_attempts():
    slugs = [f"slug{i:04d}" for i in range(project_store.MAX_SLUG_ATTEMPTS)]
    duplicate_error = RuntimeError("duplicate key value violates unique constraint projects_share_slug_key")

    with patch("project_store._generate_slug", side_effect=slugs):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.side_effect = duplicate_error
            mock_supabase.table.return_value = insert_table

            with pytest.raises(RuntimeError, match="duplicate key value violates unique constraint") as exc:
                await project_store.create_named_project("user-1", "My Project")

    assert insert_table.insert.call_count == project_store.MAX_SLUG_ATTEMPTS
    assert exc.value is duplicate_error


async def test_update_project_fields_updates_by_id_and_user():
    update_chain = _mock_chain([])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain
        await project_store.update_project_fields("project-1", "user-1", {"nodes": []})

    update_chain.update.assert_called_once()
    assert update_chain.eq.call_count == 2
    method_order = [entry[0] for entry in update_chain.method_calls]
    assert "select" not in method_order


def test_save_canvas_snapshot_sync_updates_by_id_and_user():
    ownership_chain = _mock_chain({"id": "project-1", "setup_pdf_status": "ready"})
    update_chain = _mock_chain([{"id": "project-1"}])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.side_effect = [ownership_chain, update_chain]
        project_store._save_canvas_snapshot_sync(
            "project-1",
            "user-1",
            [{"id": "n1"}],
            [{"id": "e1"}],
        )

    update_chain.update.assert_called_once()
    payload = update_chain.update.call_args.args[0]
    assert payload["nodes"] == [{"id": "n1"}]
    assert payload["edges"] == [{"id": "e1"}]
    assert isinstance(payload["updated_at"], str)
    assert isinstance(payload["architecture_modified_at"], str)
    assert payload["setup_pdf_status"] == "outdated"
    assert update_chain.eq.call_count == 2


def test_save_canvas_snapshot_sync_raises_when_project_not_found_or_not_owned():
    ownership_chain = _mock_chain(None)

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = ownership_chain
        with pytest.raises(RuntimeError, match="Project not found or not owned by user."):
            project_store._save_canvas_snapshot_sync(
                "project-1",
                "user-1",
                [{"id": "n1"}],
                [{"id": "e1"}],
            )


def test_save_canvas_snapshot_sync_non_list_update_payload_succeeds_when_owned_project_exists():
    ownership_probe = _mock_chain({"id": "project-1", "setup_pdf_status": "none"})
    update_chain = _mock_chain({"status": "ok"})

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.side_effect = [ownership_probe, update_chain]
        project_store._save_canvas_snapshot_sync(
            "project-1",
            "user-1",
            [{"id": "n1"}],
            [{"id": "e1"}],
        )

    ownership_probe.select.assert_called_once_with("id, setup_pdf_status")
    assert ownership_probe.eq.call_count == 2


def test_save_canvas_snapshot_sync_non_list_update_payload_raises_when_owned_project_does_not_exist():
    ownership_probe = _mock_chain({"id": "project-1", "setup_pdf_status": "none"})
    update_chain = _mock_chain({"status": "ok"})

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.side_effect = [ownership_probe, update_chain]
        project_store._save_canvas_snapshot_sync(
            "project-1",
            "user-1",
            [{"id": "n1"}],
            [{"id": "e1"}],
        )

    ownership_probe.select.assert_called_once_with("id, setup_pdf_status")
    assert ownership_probe.eq.call_count == 2


def test_save_canvas_snapshot_sync_raises_when_update_returns_empty_after_ownership_probe():
    ownership_probe = _mock_chain({"id": "project-1", "setup_pdf_status": "none"})
    update_chain = _mock_chain([])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.side_effect = [ownership_probe, update_chain]
        with pytest.raises(RuntimeError, match="Project not found or not owned by user."):
            project_store._save_canvas_snapshot_sync(
                "project-1",
                "user-1",
                [{"id": "n1"}],
                [{"id": "e1"}],
            )

    ownership_probe.select.assert_called_once_with("id, setup_pdf_status")
    assert ownership_probe.eq.call_count == 2


def test_save_canvas_snapshot_sync_visual_only_skips_architecture_timestamp_and_pdf_status():
    """Visual-only saves (structure_changed=False) should not bump architecture_modified_at or mark PDF outdated."""
    ownership_chain = _mock_chain({"id": "project-1", "setup_pdf_status": "ready"})
    update_chain = _mock_chain([{"id": "project-1"}])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.side_effect = [ownership_chain, update_chain]
        project_store._save_canvas_snapshot_sync(
            "project-1",
            "user-1",
            [{"id": "n1", "position": {"x": 100, "y": 200}}],
            [{"id": "e1"}],
            structure_changed=False,
        )

    update_chain.update.assert_called_once()
    payload = update_chain.update.call_args.args[0]
    assert payload["nodes"] == [{"id": "n1", "position": {"x": 100, "y": 200}}]
    assert payload["edges"] == [{"id": "e1"}]
    assert isinstance(payload["updated_at"], str)
    assert "architecture_modified_at" not in payload
    assert "setup_pdf_status" not in payload


def test_reset_stale_generations_does_not_call_select_after_update():
    update_chain = _mock_chain([{"id": "project-1"}])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain
        count = project_store._reset_stale_generations_sync()

    assert count == 1
    method_order = [entry[0] for entry in update_chain.method_calls]
    assert "select" not in method_order


# ---------------------------------------------------------------------------
# BUG-2: asyncio.to_thread wrapping — public functions must be coroutines
# ---------------------------------------------------------------------------


def test_get_project_for_user_is_coroutine():
    """BUG-2: get_project_for_user must be an async function (coroutine)."""
    assert asyncio.iscoroutinefunction(project_store.get_project_for_user)


def test_create_project_for_generation_is_coroutine():
    """BUG-2: create_project_for_generation must be an async function (coroutine)."""
    assert asyncio.iscoroutinefunction(project_store.create_project_for_generation)


def test_create_named_project_is_coroutine():
    assert asyncio.iscoroutinefunction(project_store.create_named_project)


def test_update_project_fields_is_coroutine():
    """BUG-2: update_project_fields must be an async function (coroutine)."""
    assert asyncio.iscoroutinefunction(project_store.update_project_fields)


def test_save_canvas_snapshot_is_coroutine():
    assert asyncio.iscoroutinefunction(project_store.save_canvas_snapshot)


def test_get_project_for_user_selects_project_mode():
    select_chain = _mock_chain({"id": "project-1", "user_id": "user-1"})

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = select_chain
        project_store._get_project_for_user_sync("project-1", "user-1")

    selected = select_chain.select.call_args.args[0]
    assert "project_mode" in selected


# ---------------------------------------------------------------------------
# Transient persistence retry tests
# ---------------------------------------------------------------------------

def _make_api_error(message: str = "Internal Server Error", code: str = "500", details: str = "") -> Exception:
    body = f'<html><head><title>{message}</title></head><body><center><h1>{code} {message}</h1></center><hr><center>cloudflare</center></body></html>{details}'
    return APIError({"message": f"JSON could not be generated", "code": code, "details": body})


async def test_update_project_fields_retries_on_transient_api_error_and_succeeds():
    """Transient APIError (Cloudflare 500) should be retried and eventually succeed."""
    success_response = MagicMock()
    success_response.data = []
    update_chain = _mock_chain([])
    update_chain.execute.side_effect = [
        APIError({"message": "Internal Server Error", "code": "500", "details": "<html>500</html>"}),
        APIError({"message": "Internal Server Error", "code": "500", "details": "<html>500</html>"}),
        success_response,
    ]

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain

        await project_store.update_project_fields("project-1", "user-1", {"nodes": [{"id": "vpc"}]})

    assert update_chain.execute.call_count == 3


async def test_update_project_fields_raises_after_max_retries_exhausted():
    """After exhausting retry budget, update_project_fields should raise the last error."""
    update_chain = _mock_chain([])
    update_chain.execute.side_effect = APIError(
        {"message": "Internal Server Error", "code": "500", "details": "<html>500</html>"}
    )

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain

        with pytest.raises(APIError):
            await project_store.update_project_fields("project-1", "user-1", {"nodes": [{"id": "vpc"}]})

    assert update_chain.execute.call_count == 3


async def test_update_project_fields_does_not_retry_non_transient_errors():
    """Non-transient errors (e.g., row not found) should not be retried."""
    update_chain = _mock_chain([])
    update_chain.execute.side_effect = APIError(
        {"message": "Not found", "code": "PGRST116", "details": "The resource was not found"}
    )

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain

        with pytest.raises(APIError):
            await project_store.update_project_fields("project-1", "user-1", {"nodes": [{"id": "vpc"}]})

    assert update_chain.execute.call_count == 1


async def test_update_project_fields_rejects_non_json_safe_payload_before_write(caplog):
    with patch("project_store.supabase") as mock_supabase:
        with caplog.at_level(logging.ERROR):
            with pytest.raises(TypeError, match="JSON-serializable"):
                await project_store.update_project_fields(
                    "project-1",
                    "user-1",
                    {"nodes": [{"id": "vpc", "bad": {"not-json-safe"}}]},
                )

    mock_supabase.table.assert_not_called()
    assert any("rejected non-JSON-safe payload" in record.message for record in caplog.records)


async def test_update_project_fields_logs_transient_retries(caplog):
    success_response = MagicMock()
    success_response.data = []
    update_chain = _mock_chain([])
    update_chain.execute.side_effect = [
        APIError({"message": "Internal Server Error", "code": "500", "details": "<html>500</html>"}),
        success_response,
    ]

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain
        with patch("project_store.asyncio.sleep", new=AsyncMock(return_value=None)):
            with caplog.at_level(logging.WARNING):
                await project_store.update_project_fields("project-1", "user-1", {"nodes": [{"id": "vpc"}]})

    assert any("transient failure attempt 1/3" in record.message for record in caplog.records)
