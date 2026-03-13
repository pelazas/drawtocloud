from supabase_client import supabase


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
    quota = get_user_quota(user_id)
    next_value = quota["generations_used"] + 1

    (
        supabase.table("profiles")
        .update({"generations_used": next_value})
        .eq("id", user_id)
        .execute()
    )
