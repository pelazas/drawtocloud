import asyncio
from unittest.mock import MagicMock, patch

import pytest

import auth
from auth import AuthUser, verify_access_token, verify_access_token_user


def test_verify_access_token_user_is_coroutine():
    assert asyncio.iscoroutinefunction(verify_access_token_user)


def test_verify_access_token_is_coroutine():
    assert asyncio.iscoroutinefunction(verify_access_token)


async def test_verify_access_token_user_returns_auth_user_on_valid_token():
    mock_user = MagicMock()
    mock_user.id = "user123"
    mock_user.email = "a@b.com"

    mock_response = MagicMock()
    mock_response.user = mock_user

    with patch.object(auth.supabase.auth, "get_user", return_value=mock_response):
        result = await verify_access_token_user("valid-token")

    assert result == AuthUser(user_id="user123", email="a@b.com")


async def test_verify_access_token_user_returns_none_on_exception():
    with patch.object(auth.supabase.auth, "get_user", side_effect=Exception("network error")):
        result = await verify_access_token_user("any-token")

    assert result is None


async def test_verify_access_token_user_returns_none_when_no_user():
    mock_response = MagicMock()
    mock_response.user = None

    with patch.object(auth.supabase.auth, "get_user", return_value=mock_response):
        result = await verify_access_token_user("token-with-no-user")

    assert result is None


async def test_verify_access_token_returns_user_id_string():
    mock_user = MagicMock()
    mock_user.id = "user456"
    mock_user.email = "x@y.com"

    mock_response = MagicMock()
    mock_response.user = mock_user

    with patch.object(auth.supabase.auth, "get_user", return_value=mock_response):
        result = await verify_access_token("valid-token")

    assert result == "user456"
    assert isinstance(result, str)
