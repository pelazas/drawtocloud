import os
from supabase import create_client, Client


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} env var is required but not set")
    return value


supabase: Client = create_client(
    _require_env("SUPABASE_URL"),
    _require_env("SUPABASE_SECRET_KEY"),  # service key for server-side ops
)
