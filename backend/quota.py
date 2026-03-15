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


def get_user_quota(user_id: str) -> dict[str, int]:
    data = _read_profile_quota(user_id)
    used = int(data.get("generations_used", 0))
    limit = int(data.get("generations_limit", 0))
    return {"generations_used": used, "generations_limit": limit}


def increment_generations_used(user_id: str) -> None:
    """Atomically increment generations_used via a Supabase RPC.

    The RPC executes:
        UPDATE profiles
        SET generations_used = generations_used + 1
        WHERE id = $1 AND generations_used < generations_limit
        RETURNING *

    If no row is returned the user has exhausted their quota and
    QuotaExhaustedError is raised.
    """
    response = supabase.rpc(
        "increment_generations_used", {"user_id": user_id}
    ).execute()

    data = getattr(response, "data", None)
    if not data:
        raise QuotaExhaustedError(
            f"Generation quota exhausted for user {user_id}"
        )
