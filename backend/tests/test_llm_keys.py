import os

import pytest

os.environ.setdefault("LLM_KEY_ENCRYPTION_SECRET", "test-secret-key-for-unit-tests-only!!")

from llm_keys import decrypt_api_key, encrypt_api_key


def test_encrypt_decrypt_roundtrip() -> None:
    original = "sk-ant-api03-test-key-1234567890"
    encrypted = encrypt_api_key(original)
    assert encrypted != original
    assert decrypt_api_key(encrypted) == original


def test_encrypted_values_differ() -> None:
    """Fernet produces different ciphertext each time (random IV)."""
    key = "sk-test-key"
    a = encrypt_api_key(key)
    b = encrypt_api_key(key)
    assert a != b


def test_decrypt_invalid_token() -> None:
    with pytest.raises(Exception):
        decrypt_api_key("not-valid-fernet-token")
