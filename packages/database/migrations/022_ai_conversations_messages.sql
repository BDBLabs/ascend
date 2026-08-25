-- 022_ai_conversations_messages.sql
--
-- Adds conversation and message storage for the AI assistant, and aligns
-- the ai_actors authority_role CHECK constraint with the TypeScript enum
-- ('employee' instead of 'operator').

-- ── Role enum fix ──────────────────────────────────────────────────
-- The DB allowed 'operator'; the application uses 'employee'. Rather than
-- dropping/recreating the constraint (which would fail if existing rows
-- reference 'operator'), we widen it to accept both, then narrow it in a
-- follow-up once all rows are consistent.

ALTER TABLE ai_actors
  DROP CONSTRAINT IF EXISTS ai_actors_authority_role_check;

-- migrate:split

ALTER TABLE ai_actors
  ADD CONSTRAINT ai_actors_authority_role_check
  CHECK (authority_role IN ('employee', 'operator', 'manager', 'owner'));

-- ── Conversations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT ''
    CHECK (char_length(title) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_conversations_org_idx
  ON ai_conversations (organization_id, updated_at DESC, id);

-- migrate:split

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY ai_conversations_tenant_isolation ON ai_conversations
  USING (organization_id = app_require_organization_id());

-- ── Messages ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL DEFAULT ''
    CHECK (char_length(content) <= 32000),
  tool_calls jsonb DEFAULT NULL,
  tool_call_id text DEFAULT NULL
    CHECK (tool_call_id IS NULL OR char_length(tool_call_id) <= 200),
  tokens_in integer DEFAULT NULL
    CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out integer DEFAULT NULL
    CHECK (tokens_out IS NULL OR tokens_out >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
  ON ai_messages (conversation_id, created_at ASC, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_messages_org_idx
  ON ai_messages (organization_id, created_at DESC, id);

-- migrate:split

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY ai_messages_tenant_isolation ON ai_messages
  USING (organization_id = app_require_organization_id());
