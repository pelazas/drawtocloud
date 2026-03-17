import asyncio

from supabase_client import supabase


class QuotaExhaustedError(Exception):
    """Raised when a user has reached their generation limit."""


def _read_profile_quota(user_id: str) -> dict:
    response = (
        supabase.table("profiles")
        .select("generations_used, generations_limit")
        .eq("id", user_id)
        .single()
        .execute()
    )

    data = getattr(response, "data", None)
    if not isinstance(data, dict):
        raise RuntimeError("Profile row not found.")

    return data


async def get_user_quota(user_id: str) -> dict[str, int]:
    data = await asyncio.to_thread(_read_profile_quota, user_id)
    used = int(data.get("generations_used", 0))
    limit = int(data.get("generations_limit", 0))
    return {"generations_used": used, "generations_limit": limit}


def _increment_generations_used_sync(user_id: str) -> None:
    """Synchronous worker for increment_generations_used; called via asyncio.to_thread."""
    response = supabase.rpc(
        "increment_generations_used", {"user_id": user_id}
    ).execute()

    data = getattr(response, "data", None)
    if not data:
        raise QuotaExhaustedError(
            f"Generation quota exhausted for user {user_id}"
        )


async def increment_generations_used(user_id: str) -> None:
    """Atomically increment generations_used via a Supabase RPC.

    The RPC executes:
        UPDATE profiles
        SET generations_used = generations_used + 1
        WHERE id = $1 AND generations_used < generations_limit
        RETURNING *

    If no row is returned the user has exhausted their quota and
    QuotaExhaustedError is raised.
    """
    await asyncio.to_thread(_increment_generations_used_sync, user_id)


def _check_and_reserve_quota_sync(user_id: str) -> dict:
    """Synchronous worker; called via asyncio.to_thread."""
    response = supabase.rpc("check_and_reserve_quota", {"p_user_id": user_id}).execute()
    data = getattr(response, "data", None)
    if not isinstance(data, dict):
        raise RuntimeError(f"check_and_reserve_quota returned unexpected data: {data!r}")
    return data


async def check_and_reserve_quota(user_id: str) -> dict:
    """Atomically check and reserve a quota slot for the user.

    Calls the check_and_reserve_quota Supabase RPC (migration 007) which
    performs a single-transaction UPDATE:

        UPDATE profiles
        SET generations_used = generations_used + 1
        WHERE id = p_user_id AND generations_used < generations_limit
        RETURNING generations_used, generations_limit

    Returns a dict with keys:
        ok               — True if quota was reserved, False otherwise
        error            — None | "quota_exhausted" | "profile_not_found"
        generations_used  — current value (after increment on success)
        generations_limit — configured limit

    Unlike the old two-step get_user_quota + increment_generations_used
    pattern, this is atomic: two concurrent calls for the same user cannot
    both succeed when only one slot remains.

    NOTE: quota is now reserved at generation START (not on completion).
    Failed generations consume a quota slot.

    Requires migration 007_check_and_reserve_quota_rpc.sql to be applied.
    """
    return await asyncio.to_thread(_check_and_reserve_quota_sync, user_id)
