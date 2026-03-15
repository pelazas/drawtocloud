"""Tests for quota.py — atomic increment via Supabase RPC (BUG-1) and asyncio wrapping (BUG-2)."""
import asyncio
from unittest.mock import MagicMock, patch

import pytest

import quota


def _make_rpc_response(data):
    """Build a mock response object with .data attribute."""
    response = MagicMock()
    response.data = data
    return response


def _make_rpc_chain(data):
    """Build a mock supabase.rpc(...).execute() chain returning data."""
    chain = MagicMock()
    chain.execute.return_value = _make_rpc_response(data)
    return chain


# ---------------------------------------------------------------------------
# Tests for increment_generations_used
# ---------------------------------------------------------------------------


async def test_increment_calls_rpc_with_correct_args():
    """increment_generations_used must call supabase.rpc with the right name and param."""
    updated_row = [{"id": "user123", "generations_used": 5, "generations_limit": 10}]
    rpc_chain = _make_rpc_chain(updated_row)

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        await quota.increment_generations_used("user123")

    mock_supabase.rpc.assert_called_once_with(
        "increment_generations_used", {"user_id": "user123"}
    )


async def test_increment_raises_quota_exhausted_when_rpc_returns_empty_list():
    """If the RPC returns [], quota was already at the limit — raise QuotaExhaustedError."""
    rpc_chain = _make_rpc_chain([])

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        with pytest.raises(quota.QuotaExhaustedError):
            await quota.increment_generations_used("user123")


async def test_increment_raises_quota_exhausted_when_rpc_returns_none():
    """If the RPC returns None, treat it as quota exhausted."""
    rpc_chain = _make_rpc_chain(None)

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        with pytest.raises(quota.QuotaExhaustedError):
            await quota.increment_generations_used("user123")


async def test_increment_succeeds_on_happy_path():
    """If the RPC returns a non-empty row list, the call should return without error."""
    updated_row = [{"id": "user123", "generations_used": 3, "generations_limit": 10}]
    rpc_chain = _make_rpc_chain(updated_row)

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        # Should not raise
        await quota.increment_generations_used("user123")


def test_quota_exhausted_error_is_exported():
    """QuotaExhaustedError must be importable from quota module."""
    assert hasattr(quota, "QuotaExhaustedError")
    assert issubclass(quota.QuotaExhaustedError, Exception)


async def test_increment_does_not_call_table():
    """The fixed implementation must NOT fall back to the racy table.update() path."""
    updated_row = [{"id": "user123", "generations_used": 2, "generations_limit": 10}]
    rpc_chain = _make_rpc_chain(updated_row)

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        await quota.increment_generations_used("user123")

    mock_supabase.table.assert_not_called()


# ---------------------------------------------------------------------------
# Tests for get_user_quota / _read_profile_quota
# ---------------------------------------------------------------------------


def _make_table_chain(data):
    """Build a mock for supabase.table(...).select(...).eq(...).single().execute()."""
    response = MagicMock()
    response.data = data

    execute_mock = MagicMock(return_value=response)
    single_mock = MagicMock()
    single_mock.execute = execute_mock
    eq_mock = MagicMock()
    eq_mock.single.return_value = single_mock
    select_mock = MagicMock()
    select_mock.eq.return_value = eq_mock
    table_mock = MagicMock()
    table_mock.select.return_value = select_mock
    return table_mock


async def test_get_user_quota_returns_correct_shape():
    """get_user_quota must return the correct dict when the profile row exists."""
    profile_data = {"generations_used": 3, "generations_limit": 5}

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.table.return_value = _make_table_chain(profile_data)
        result = await quota.get_user_quota("user123")

    assert result == {"generations_used": 3, "generations_limit": 5}


async def test_get_user_quota_raises_when_profile_not_found():
    """get_user_quota must raise RuntimeError when the profile row is missing."""
    for bad_data in (None, [], "unexpected"):
        with patch("quota.supabase") as mock_supabase:
            mock_supabase.table.return_value = _make_table_chain(bad_data)
            with pytest.raises(RuntimeError):
                await quota.get_user_quota("user123")


# ---------------------------------------------------------------------------
# BUG-2: asyncio.to_thread wrapping — public functions must be coroutines
# ---------------------------------------------------------------------------


def test_get_user_quota_is_coroutine():
    """BUG-2: get_user_quota must be an async function (coroutine)."""
    assert asyncio.iscoroutinefunction(quota.get_user_quota)


def test_increment_generations_used_is_coroutine():
    """BUG-2: increment_generations_used must be an async function (coroutine)."""
    assert asyncio.iscoroutinefunction(quota.increment_generations_used)


async def test_increment_is_awaitable_and_uses_rpc():
    """BUG-2: increment_generations_used must be awaitable and call rpc correctly."""
    updated_row = [{"id": "user123", "generations_used": 2, "generations_limit": 10}]
    rpc_chain = _make_rpc_chain(updated_row)

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.rpc.return_value = rpc_chain
        await quota.increment_generations_used("user123")

    mock_supabase.rpc.assert_called_once_with(
        "increment_generations_used", {"user_id": "user123"}
    )


async def test_get_user_quota_is_awaitable_and_returns_correct_shape():
    """BUG-2: get_user_quota must be awaitable and return the correct dict."""
    profile_data = {"generations_used": 3, "generations_limit": 5}

    with patch("quota.supabase") as mock_supabase:
        mock_supabase.table.return_value = _make_table_chain(profile_data)
        result = await quota.get_user_quota("user123")

    assert result == {"generations_used": 3, "generations_limit": 5}
