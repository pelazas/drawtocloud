-- Migration: add salt and encryption_version to user_llm_keys (issue 228)
-- Strengthen BYOK encryption with proper key derivation

-- Add per-user salt (nullable for backward compatibility with v1 keys)
ALTER TABLE user_llm_keys
ADD COLUMN IF NOT EXISTS salt text;

-- Add encryption version tracking (1 = legacy SHA256, 2 = PBKDF2)
ALTER TABLE user_llm_keys
ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1;

-- Existing rows will have version=1 and salt=NULL, which triggers legacy decryption path
-- They are auto-migrated to v2 on the next read via get_user_llm_key()
