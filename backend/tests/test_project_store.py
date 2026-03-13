from unittest.mock import MagicMock, patch

import project_store


def _mock_chain(data):
    chain = MagicMock()
    response = MagicMock()
    response.data = data
    chain.execute.return_value = response

    chain.select.return_value = chain
    chain.eq.return_value = chain
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


def test_create_project_for_generation_retries_on_duplicate_slug():
    insert_chain = _mock_chain([{"id": "p1", "share_slug": "slug0002"}])

    with patch("project_store._generate_slug", side_effect=["slug0001", "slug0002"]):
        with patch("project_store.supabase") as mock_supabase:
            insert_table = MagicMock()
            insert_table.insert.side_effect = [
                Exception("duplicate key value violates unique constraint projects_share_slug_key"),
                insert_chain,
            ]
            mock_supabase.table.return_value = insert_table

            row = project_store.create_project_for_generation("user-1", {"app_name": "Demo"})

    assert row["id"] == "p1"
    assert row["share_slug"] == "slug0002"


def test_update_project_fields_updates_by_id_and_user():
    update_chain = _mock_chain([])

    with patch("project_store.supabase") as mock_supabase:
        mock_supabase.table.return_value = update_chain
        project_store.update_project_fields("project-1", "user-1", {"nodes": []})

    update_chain.update.assert_called_once()
    assert update_chain.eq.call_count == 2
