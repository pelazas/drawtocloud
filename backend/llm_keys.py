import asyncio
import base64
import hashlib
import os
from datetime import datetime, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from supabase_client import supabase

_TABLE = "user_llm_keys"


class LlmKeyDecryptError(Exception):
    """Raised when a stored BYOK key cannot be decrypted (e.g., rotated LLM_KEY_ENCRYPTION_SECRET)."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _derive_fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from LLM_KEY_ENCRYPTION_SECRET env var."""
    secret = os.environ.get("LLM_KEY_ENCRYPTION_SECRET", "")
    if not secret:
        raise RuntimeError("LLM_KEY_ENCRYPTION_SECRET env var is required for BYOK.")

    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_api_key(plaintext: str) -> str:
    fernet = Fernet(_derive_fernet_key())
    return fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_api_key(ciphertext: str) -> str:
    fernet = Fernet(_derive_fernet_key())
    try:
        return fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise LlmKeyDecryptError(
            "Your API key could not be decrypted — please re-enter it in Settings."
        ) from exc


def _upsert_key_sync(user_id: str, provider: str, encrypted_key: str, model: str | None) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "provider": provider,
        "encrypted_key": encrypted_key,
        "model": model,
        "updated_at": _utc_now(),
    }
    response = supabase.table(_TABLE).upsert(payload, on_conflict="user_id").execute()
    data = getattr(response, "data", None)
    if isinstance(data, list) and data:
        row = data[0]
        if isinstance(row, dict):
            return row
    raise RuntimeError("Failed to save LLM key.")


def _get_key_sync(user_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table(_TABLE)
        .select("provider, encrypted_key, model")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    data = getattr(response, "data", None)
    if isinstance(data, list) and data:
        row = data[0]
        if isinstance(row, dict):
            return row
    if isinstance(data, dict):
        return data
    return None


async def save_user_llm_key(user_id: str, provider: str, api_key: str, model: str | None = None) -> dict[str, Any]:
    encrypted = encrypt_api_key(api_key)
    return await asyncio.to_thread(_upsert_key_sync, user_id, provider, encrypted, model)


async def get_user_llm_key(user_id: str) -> dict[str, Any] | None:
    """Returns {provider, api_key (decrypted), model} or None."""
    row = await asyncio.to_thread(_get_key_sync, user_id)
    if not row:
        return None

    return {
        "provider": row["provider"],
        "api_key": decrypt_api_key(row["encrypted_key"]),
        "model": row.get("model"),
    }


async def get_user_llm_key_status(user_id: str) -> dict[str, Any] | None:
    """Returns {provider, has_key, model} without decrypting."""
    row = await asyncio.to_thread(_get_key_sync, user_id)
    if not row:
        return None

    return {
        "provider": row["provider"],
        "has_key": True,
        "model": row.get("model"),
    }


def _delete_key_sync(user_id: str) -> None:
    supabase.table(_TABLE).delete().eq("user_id", user_id).execute()


async def delete_user_llm_key(user_id: str) -> None:
    await asyncio.to_thread(_delete_key_sync, user_id)
