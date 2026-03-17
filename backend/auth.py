import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from supabase_client import supabase

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: str


def _extract_user_id(user: Any) -> str | None:
    if user is None:
        return None

    if isinstance(user, dict):
        user_id = user.get("id")
        return str(user_id) if user_id else None

    user_id = getattr(user, "id", None)
    return str(user_id) if user_id else None


def _extract_user_email(user: Any) -> str | None:
    if user is None:
        return None

    if isinstance(user, dict):
        email = user.get("email")
        return str(email).strip() if isinstance(email, str) and email.strip() else None

    email = getattr(user, "email", None)
    return str(email).strip() if isinstance(email, str) and email.strip() else None


def _verify_access_token_user_sync(access_token: str) -> AuthUser | None:
    """Synchronous worker; called via asyncio.to_thread."""
    try:
        response = supabase.auth.get_user(access_token)
    except Exception as exc:
        logger.warning("supabase.auth.get_user failed (network error or Supabase outage?): %s", exc)
        return None

    user = getattr(response, "user", None)
    user_id = _extract_user_id(user)
    email = _extract_user_email(user)
    if not user_id or not email:
        return None

    return AuthUser(user_id=user_id, email=email)


async def verify_access_token_user(access_token: str) -> AuthUser | None:
    """Return authenticated user id/email when token is valid, otherwise None."""
    return await asyncio.to_thread(_verify_access_token_user_sync, access_token)


async def verify_access_token(access_token: str) -> str | None:
    """Return the authenticated user id when token is valid, otherwise None."""
    user = await verify_access_token_user(access_token)
    return user.user_id if user else None
