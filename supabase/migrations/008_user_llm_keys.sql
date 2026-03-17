-- Run this in Supabase SQL editor
CREATE TABLE IF NOT EXISTS user_llm_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openrouter', 'openai')),
  encrypted_key text NOT NULL,
  model text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_llm_keys ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (backend uses service key)
DROP POLICY IF EXISTS "Service role full access" ON user_llm_keys;
CREATE POLICY "Service role full access" ON user_llm_keys
  FOR ALL USING (true) WITH CHECK (true);
