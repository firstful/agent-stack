-- ===========================================================================
--  FUSE Postgres migration 001 — initial schema
-- ===========================================================================
-- Applied manually or via: psql $DATABASE_URL -f src/db/migrations/001_initial.sql
-- ===========================================================================

CREATE TABLE IF NOT EXISTS domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  contact_email   TEXT NOT NULL CHECK (contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  trust_level     SMALLINT NOT NULL DEFAULT 2 CHECK (trust_level BETWEEN 0 AND 4),
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dns_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  rdata       TEXT[] NOT NULL,
  ttl         INTEGER NOT NULL,
  UNIQUE (domain_id, label)
);

CREATE TABLE IF NOT EXISTS identities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id             UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  display_name          TEXT NOT NULL,
  handle                TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('human','agent','shared','service','guest')),
  avatar_url            TEXT,
  bio                   TEXT,
  banned                BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ,
  opt_out_of_federation BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (domain_id, handle)
);

CREATE TABLE IF NOT EXISTS identity_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL UNIQUE,
  rawbytes     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS identity_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  device_label TEXT,
  device_id    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS channels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id        UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('public','private','dm','group','cross_org')),
  description      TEXT,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  cross_org_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_address     TEXT NOT NULL,
  created_by_id    UUID NOT NULL REFERENCES identities(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  UNIQUE (domain_id, name)
);

CREATE TABLE IF NOT EXISTS channel_permissions (
  channel_id           UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  write_members        BOOLEAN NOT NULL DEFAULT TRUE,
  write_guests         BOOLEAN NOT NULL DEFAULT FALSE,
  write_cross_org      BOOLEAN NOT NULL DEFAULT FALSE,
  max_attachment_bytes INTEGER NOT NULL DEFAULT 10485760,
  attachments_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  audit_log            JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_required    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS channel_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  member_name TEXT,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  muted       BOOLEAN NOT NULL DEFAULT FALSE,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at     TIMESTAMPTZ,
  UNIQUE (channel_id, identity_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id           UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  parent_id            UUID REFERENCES messages(id),
  author_id            UUID NOT NULL REFERENCES identities(id),
  body                 TEXT NOT NULL,
  body_html            TEXT,
  rfc822_source        TEXT,
  rfc822_content_type  TEXT,
  thread_id            UUID REFERENCES messages(id),
  rich_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  type                 TEXT NOT NULL CHECK (type IN ('user','agent','system','bot','cross_org','webhook')),
  status               TEXT NOT NULL CHECK (status IN ('pending','sent','delivered','read','failed','deleted','moderated')),
  smtp_message_id      TEXT,
  cross_org            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ,
  edited_by_id         UUID REFERENCES identities(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);

CREATE TABLE IF NOT EXISTS meetings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id         UUID REFERENCES channels(id) ON DELETE SET NULL,
  created_by_id      UUID NOT NULL REFERENCES identities(id),
  title              TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('scheduled','ringing','active','recording','paused','ended','cancelled')),
  scheduled_at       TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  recording_requested BOOLEAN NOT NULL DEFAULT FALSE,
  participants       JSONB NOT NULL DEFAULT '[]'::jsonb,
  recordings         JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   UUID REFERENCES channels(id) ON DELETE CASCADE,
  created_by_id UUID NOT NULL REFERENCES identities(id),
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  locked       BOOLEAN NOT NULL DEFAULT FALSE,
  root_block_id UUID,
  blocks       JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels       TEXT[] NOT NULL DEFAULT '{}',
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ,
  UNIQUE (channel_id, slug)
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id                   UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  url                         TEXT NOT NULL,
  signing_key_fingerprint     TEXT NOT NULL,
  signing_key_raw             TEXT NOT NULL,
  secret_token                TEXT NOT NULL,
  subscribed_events           TEXT[] NOT NULL DEFAULT '{}',
  max_retries                 INTEGER NOT NULL DEFAULT 3,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at                TIMESTAMPTZ,
  last_failed_at              TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL,
  response_status INTEGER,
  response_body   TEXT,
  signature_verified BOOLEAN,
  success         BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  latency_ms      INTEGER
);

-- ===========================================================================
--  LISTEN/NOTIFY triggers
-- ===========================================================================

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  payload = json_build_object(
    'id', NEW.id,
    'channel_id', NEW.channel_id,
    'type', 'message:created'
  );
  PERFORM pg_notify('fuse_events', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_new_message ON messages;
CREATE TRIGGER trigger_notify_new_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();

CREATE OR REPLACE FUNCTION notify_presence()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  payload = json_build_object(
    'identity_id', NEW.id,
    'type', 'presence:updated',
    'status', CASE WHEN NEW.last_seen_at IS NOT NULL THEN 'online' ELSE 'away' END
  );
  PERFORM pg_notify('fuse_events', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_presence ON identities;
CREATE TRIGGER trigger_notify_presence
  AFTER UPDATE OF last_seen_at ON identities
  FOR EACH ROW
  WHEN (OLD.last_seen_at IS DISTINCT FROM NEW.last_seen_at)
  EXECUTE FUNCTION notify_presence();
