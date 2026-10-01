-- Phase 3: staff sign-in and the audit trail (spec §5.2 "Nhân viên, quản trị", §7.1).
--
-- The five Better Auth tables are the output of
--   AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<empty>_test \
--     npx auth generate --config scripts/auth-cli.config.ts --output <file>
-- (better-auth 1.7.7, after modelName/fields and the admin plugin were set in
-- lib/server/auth/config.ts), with IF NOT EXISTS added and one CHECK on role.
-- Better Auth validates this shape at start-up (database.validateSchema), so
-- change config.ts and regenerate rather than editing the columns here.

-- ── Better Auth ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_user (
  id             text        NOT NULL PRIMARY KEY,
  name           text        NOT NULL,
  email          text        NOT NULL UNIQUE,
  email_verified boolean     NOT NULL,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- admin plugin
  role           text        CONSTRAINT staff_user_role_check CHECK (role IN ('admin', 'editor')),
  banned         boolean,
  ban_reason     text,
  ban_expires    timestamptz
);

CREATE TABLE IF NOT EXISTS staff_session (
  id              text        NOT NULL PRIMARY KEY,
  expires_at      timestamptz NOT NULL,
  token           text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamptz NOT NULL,
  ip_address      text,
  user_agent      text,
  user_id         text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  -- admin plugin; stays NULL: no role may impersonate (spec §7.1)
  impersonated_by text
);

CREATE TABLE IF NOT EXISTS staff_account (
  id                       text        NOT NULL PRIMARY KEY,
  account_id               text        NOT NULL,
  provider_id              text        NOT NULL,
  user_id                  text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_verification (
  id         text        NOT NULL PRIMARY KEY,
  identifier text        NOT NULL,
  value      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- rateLimit.storage = 'database': one row per "<ip>|<path>" key.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id           text    NOT NULL PRIMARY KEY,
  key          text    NOT NULL UNIQUE,
  count        integer NOT NULL,
  last_request bigint  NOT NULL  -- epoch milliseconds
);

CREATE INDEX IF NOT EXISTS staff_session_user_id_idx ON staff_session (user_id);
CREATE INDEX IF NOT EXISTS staff_account_user_id_idx ON staff_account (user_id);
CREATE INDEX IF NOT EXISTS staff_verification_identifier_idx ON staff_verification (identifier);

-- ── staff_invitation ──────────────────────────────────────────────────────
-- App-owned invitations. Only the SHA-256 of the token is stored. "Gửi lại"
-- (resend) replaces token_hash and expires_at in place, so the old link dies.
CREATE TABLE IF NOT EXISTS staff_invitation (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text        NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  role        text        NOT NULL CHECK (role IN ('admin', 'editor')),
  token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  invited_by  text,       -- staff_user.id; no FK, the history outlives the inviter (spec §5.1.6)
  email_error text,       -- last delivery failure; NULL once a send succeeds
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitation_closed_once CHECK (used_at IS NULL OR revoked_at IS NULL)
);

-- One open invitation per email. "Open" here ignores expiry (now() cannot sit
-- in an index predicate); createInvitation revokes an expired one first.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_open_email_idx
  ON staff_invitation (email) WHERE used_at IS NULL AND revoked_at IS NULL;

-- ── audit_log ─────────────────────────────────────────────────────────────
-- Written in the same transaction as the change it records (spec §7.4).
-- actor_* are snapshots without FKs, so the log survives a staff removal.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    text,
  actor_email text,
  action      text        NOT NULL
              CHECK (action ~ '^(create|update|delete|reorder|restore|settings|staff\.[a-z_]+)$'),
  entity_type text        NOT NULL CHECK (entity_type <> ''),
  entity_id   text,
  locale      text,
  before      jsonb,
  after       jsonb,
  ip          inet
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- The /admin/audit timeline. Phase 4 replaces this (CREATE OR REPLACE VIEW,
-- same columns in the same order) with a UNION ALL over reservation_events.
CREATE OR REPLACE VIEW audit_feed AS
SELECT 'audit'::text   AS source,
       a.id::text      AS id,
       a.at,
       a.actor_id,
       a.actor_email   AS actor_label,
       a.action,
       a.entity_type,
       a.entity_id,
       a.locale,
       a.before,
       a.after
  FROM audit_log a;
