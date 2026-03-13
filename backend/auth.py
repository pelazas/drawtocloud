from typing import Any

from supabase_client import supabase


def _extract_user_id(user: Any) -> str | None:
    if user is None:
        return None

    if isinstance(user, dict):
        user_id = user.get("id")
        return str(user_id) if user_id else None

    user_id = getattr(user, "id", None)
    return str(user_id) if user_id else None


def verify_access_token(access_token: str) -> str | None:
    """Return the authenticated user id when token is valid, otherwise None."""
    try:
        response = supabase.auth.get_user(access_token)
    except Exception:
        return None

    return _extract_user_id(getattr(response, "user", None))
