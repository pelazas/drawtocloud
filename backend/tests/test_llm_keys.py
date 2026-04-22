import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("LLM_KEY_ENCRYPTION_SECRET", "test-secret-key-for-unit-tests-only!!")
os.environ.setdefault("LLM_KEY_ENCRYPTION_SECRET_PREVIOUS", "old-secret-key-for-rotation-tests!!")

from llm_keys import (
    LlmKeyDecryptError,
    _derive_fernet_key,
    decrypt_api_key,
    encrypt_api_key,
    validate_encryption_secret,
)


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------
def test_derive_fernet_key_v2_returns_urlsafe_b64_bytes() -> None:
    salt = b"unique-salt-16by"
    key = _derive_fernet_key("a-very-long-secret-key-32-chars!", salt, version=2)
    assert isinstance(key, bytes)
    # base64.urlsafe_b64encode of 32 bytes produces 44 bytes (including padding)
    assert len(key) == 44
    # Verify it's a valid Fernet key by constructing Fernet with it
    from cryptography.fernet import Fernet
    Fernet(key)  # raises if invalid


def test_derive_fernet_key_v2_deterministic() -> None:
    salt = b"same-salt-16byte"
    a = _derive_fernet_key("same-secret-32-characters-long!!", salt, version=2)
    b = _derive_fernet_key("same-secret-32-characters-long!!", salt, version=2)
    assert a == b


def test_derive_fernet_key_v2_different_salts_produce_different_keys() -> None:
    secret = "same-secret-32-characters-long!!"
    a = _derive_fernet_key(secret, b"salt-a-16bytes!!", version=2)
    b = _derive_fernet_key(secret, b"salt-b-16bytes!!", version=2)
    assert a != b


def test_derive_fernet_key_v1_legacy_compatible() -> None:
    """Version 1 must still produce the old SHA256-derived key for migration support."""
    secret = "legacy-secret-for-compat-tests!!"
    v1_key = _derive_fernet_key(secret, salt=None, version=1)
    # Compare against manual SHA256 derivation
    import base64
    import hashlib

    expected = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    assert v1_key == expected


# ---------------------------------------------------------------------------
# Encryption / decryption v2 (with salt)
# ---------------------------------------------------------------------------
def test_encrypt_decrypt_v2_roundtrip() -> None:
    original = "sk-ant-api03-test-key-1234567890"
    salt = os.urandom(16)
    encrypted = encrypt_api_key(original, salt)
    assert encrypted != original
    assert decrypt_api_key(encrypted, salt, version=2) == original


def test_encrypt_v2_different_salts_produce_different_ciphertext() -> None:
    key = "sk-test-key"
    salt_a = b"salt-a-16bytes!!"
    salt_b = b"salt-b-16bytes!!"
    a = encrypt_api_key(key, salt_a)
    b = encrypt_api_key(key, salt_b)
    assert a != b


def test_encrypt_v2_same_salt_different_iv() -> None:
    """Even with the same salt, Fernet uses a random IV so ciphertext should differ."""
    key = "sk-test-key"
    salt = b"fixed-salt-16byt"
    a = encrypt_api_key(key, salt)
    b = encrypt_api_key(key, salt)
    assert a != b


def test_decrypt_v2_wrong_salt_fails() -> None:
    original = "sk-ant-api03-test-key-1234567890"
    salt = b"correct-salt-16!"
    encrypted = encrypt_api_key(original, salt)
    with pytest.raises(LlmKeyDecryptError):
        decrypt_api_key(encrypted, b"wrong-salt-16byt", version=2)


# ---------------------------------------------------------------------------
# Legacy v1 decryption (no salt)
# ---------------------------------------------------------------------------
def test_decrypt_v1_legacy_roundtrip() -> None:
    """A key encrypted with the old v1 scheme must still decrypt."""
    original = "sk-ant-api03-legacy-key-0987654321"
    # Manually create a v1 ciphertext
    from cryptography.fernet import Fernet

    v1_key = _derive_fernet_key(os.environ["LLM_KEY_ENCRYPTION_SECRET"], salt=None, version=1)
    fernet = Fernet(v1_key)
    ciphertext = fernet.encrypt(original.encode("utf-8")).decode("utf-8")

    assert decrypt_api_key(ciphertext, salt=None, version=1) == original


# ---------------------------------------------------------------------------
# Key rotation (previous secret fallback)
# ---------------------------------------------------------------------------
def test_decrypt_with_previous_secret_succeeds() -> None:
    """If a key was encrypted with the previous secret, decrypt must fall back to it."""
    original = "sk-rotated-secret-test-key-12345"
    salt = os.urandom(16)
    # Encrypt with the *previous* secret
    prev_secret = os.environ["LLM_KEY_ENCRYPTION_SECRET_PREVIOUS"]
    prev_key = _derive_fernet_key(prev_secret, salt, version=2)
    from cryptography.fernet import Fernet

    fernet = Fernet(prev_key)
    ciphertext = fernet.encrypt(original.encode("utf-8")).decode("utf-8")

    # Current secret is different, so decrypt should try previous and succeed
    assert decrypt_api_key(ciphertext, salt, version=2) == original


def test_decrypt_fails_when_neither_secret_works() -> None:
    original = "sk-unknown-secret-test-key-1234"
    salt = os.urandom(16)
    # Encrypt with a totally unknown secret
    unknown_key = _derive_fernet_key("totally-unknown-secret-key-123", salt, version=2)
    from cryptography.fernet import Fernet

    fernet = Fernet(unknown_key)
    ciphertext = fernet.encrypt(original.encode("utf-8")).decode("utf-8")

    with pytest.raises(LlmKeyDecryptError):
        decrypt_api_key(ciphertext, salt, version=2)


# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------
def test_validate_encryption_secret_accepts_strong_secret() -> None:
    validate_encryption_secret("this-is-a-very-long-secret-key-32-chars!")


def test_validate_encryption_secret_rejects_short_secret() -> None:
    with pytest.raises(ValueError, match="at least 32 characters"):
        validate_encryption_secret("short")


def test_validate_encryption_secret_rejects_empty_secret() -> None:
    with pytest.raises(ValueError, match="at least 32 characters"):
        validate_encryption_secret("")


def test_validate_encryption_secret_rejects_none() -> None:
    with pytest.raises(ValueError, match="at least 32 characters"):
        validate_encryption_secret(None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# get_user_llm_key migration path (v1 -> v2 auto-re-encrypt)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_user_llm_key_migrates_v1_to_v2() -> None:
    """When a v1 (no salt) key is read, it should be decrypted and re-encrypted as v2."""
    from llm_keys import get_user_llm_key

    original_key = "sk-ant-api03-migrate-me-1234567890"
    # Build a v1 encrypted payload manually
    from cryptography.fernet import Fernet

    v1_key = _derive_fernet_key(os.environ["LLM_KEY_ENCRYPTION_SECRET"], salt=None, version=1)
    fernet = Fernet(v1_key)
    v1_ciphertext = fernet.encrypt(original_key.encode("utf-8")).decode("utf-8")

    mock_row = {
        "provider": "anthropic",
        "encrypted_key": v1_ciphertext,
        "model": None,
        "salt": None,
        "encryption_version": 1,
    }

    with patch("llm_keys._get_key_sync", return_value=mock_row):
        with patch("llm_keys._upsert_key_sync", return_value=mock_row) as mock_upsert:
            result = await get_user_llm_key("user-123")

    assert result is not None
    assert result["api_key"] == original_key
    assert result["provider"] == "anthropic"
    # The migration should have written a v2 record back
    mock_upsert.assert_called_once()
    call_args = mock_upsert.call_args
    assert call_args[0][0] == "user-123"
    assert call_args[0][1] == "anthropic"
    # The new encrypted_key should be different (v2 with salt)
    assert call_args[0][2] != v1_ciphertext
    assert call_args[0][3] is None


@pytest.mark.asyncio
async def test_get_user_llm_key_v2_no_migration() -> None:
    """When a v2 key is read, no DB write should happen."""
    from llm_keys import get_user_llm_key

    original_key = "sk-ant-api03-v2-key-1234567890"
    salt = os.urandom(16)
    v2_ciphertext = encrypt_api_key(original_key, salt)

    mock_row = {
        "provider": "openai",
        "encrypted_key": v2_ciphertext,
        "model": "gpt-4o",
        "salt": salt.hex(),
        "encryption_version": 2,
    }

    with patch("llm_keys._get_key_sync", return_value=mock_row):
        with patch("llm_keys._upsert_key_sync") as mock_upsert:
            result = await get_user_llm_key("user-456")

    assert result is not None
    assert result["api_key"] == original_key
    mock_upsert.assert_not_called()


@pytest.mark.asyncio
async def test_get_user_llm_key_returns_none_when_no_row() -> None:
    from llm_keys import get_user_llm_key

    with patch("llm_keys._get_key_sync", return_value=None):
        result = await get_user_llm_key("user-no-key")
    assert result is None
