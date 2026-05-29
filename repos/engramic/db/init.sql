CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS accounts (
  token TEXT PRIMARY KEY,
  providers JSONB NOT NULL DEFAULT '[]'::jsonb,
  profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
  global_memories JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS global_memories JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_label TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_conversation_id ON usage_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_log(created_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_user_isolation ON conversations;
CREATE POLICY conversations_user_isolation ON conversations
  USING (user_id = current_setting('app.user_id', true)::TEXT);

ALTER TABLE usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_log_user_isolation ON usage_log;
CREATE POLICY usage_log_user_isolation ON usage_log
  USING (user_id = current_setting('app.user_id', true)::TEXT);
