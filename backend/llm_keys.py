import asyncio
import base64
import hashlib
import os
import secrets
from datetime import datetime, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from supabase_client import supabase

_TABLE = "user_llm_keys"

# PBKDF2 parameters for v2 key derivation
_PBKDF2_ITERATIONS = 100_000
_PBKDF2_DKLEN = 32


class LlmKeyDecryptError(Exception):
    """Raised when a stored BYOK key cannot be decrypted (e.g., rotated LLM_KEY_ENCRYPTION_SECRET)."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _derive_fernet_key(secret: str, salt: bytes | None = None, version: int = 2) -> bytes:
    """Derive a 32-byte Fernet key from a master secret.

    - v1: simple SHA256 hash (legacy, no salt).
    - v2: PBKDF2-HMAC-SHA256 with per-user salt.
    """
    if version == 1:
        digest = hashlib.sha256(secret.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)

    if version != 2:
        raise ValueError(f"Unsupported encryption version: {version}")

    if salt is None:
        raise ValueError("salt is required for v2 key derivation")

    key = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, _PBKDF2_ITERATIONS, dklen=_PBKDF2_DKLEN)
    return base64.urlsafe_b64encode(key)


def _get_master_secret() -> str:
    secret = os.environ.get("LLM_KEY_ENCRYPTION_SECRET", "")
    if not secret:
        raise RuntimeError("LLM_KEY_ENCRYPTION_SECRET env var is required for BYOK.")
    return secret


def _get_previous_master_secret() -> str | None:
    return os.environ.get("LLM_KEY_ENCRYPTION_SECRET_PREVIOUS") or None


def encrypt_api_key(plaintext: str, salt: bytes) -> str:
    secret = _get_master_secret()
    fernet = Fernet(_derive_fernet_key(secret, salt, version=2))
    return fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_api_key(ciphertext: str, salt: bytes | None = None, version: int = 2) -> str:
    """Decrypt a ciphertext, falling back to the previous master secret on failure."""
    exc_chain: list[Exception] = []

    for secret in (_get_master_secret(), _get_previous_master_secret()):
        if secret is None:
            continue
        try:
            fernet = Fernet(_derive_fernet_key(secret, salt, version=version))
            return fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError) as exc:
            exc_chain.append(exc)

    raise LlmKeyDecryptError(
        "Your API key could not be decrypted — please re-enter it in Settings."
    )


def validate_encryption_secret(secret: str | None) -> None:
    """Validate that the master encryption secret meets minimum security requirements."""
    if not secret or len(secret) < 32:
        raise ValueError(
            "LLM_KEY_ENCRYPTION_SECRET must be at least 32 characters long. "
            "Generate a strong secret with: python -c 'import secrets; print(secrets.token_urlsafe(32))'"
        )


def _upsert_key_sync(
    user_id: str,
    provider: str,
    encrypted_key: str,
    model: str | None,
    salt: str | None = None,
    encryption_version: int = 2,
) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "provider": provider,
        "encrypted_key": encrypted_key,
        "model": model,
        "salt": salt,
        "encryption_version": encryption_version,
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
        .select("provider, encrypted_key, model, salt, encryption_version")
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
    salt = secrets.token_bytes(16)
    encrypted = encrypt_api_key(api_key, salt)
    return await asyncio.to_thread(
        _upsert_key_sync, user_id, provider, encrypted, model, salt.hex(), 2
    )


async def get_user_llm_key(user_id: str) -> dict[str, Any] | None:
    """Returns {provider, api_key (decrypted), model} or None.

    Automatically migrates v1 (legacy, no-salt) keys to v2 on read.
    """
    row = await asyncio.to_thread(_get_key_sync, user_id)
    if not row:
        return None

    ciphertext = row["encrypted_key"]
    version = row.get("encryption_version", 1)
    salt_hex = row.get("salt")
    salt = bytes.fromhex(salt_hex) if salt_hex else None

    plaintext = decrypt_api_key(ciphertext, salt=salt, version=version)

    # Auto-migrate v1 -> v2
    if version == 1:
        try:
            await save_user_llm_key(user_id, row["provider"], plaintext, row.get("model"))
        except Exception:
            # Don't fail the read if migration write fails; the key is still usable.
            pass

    return {
        "provider": row["provider"],
        "api_key": plaintext,
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
