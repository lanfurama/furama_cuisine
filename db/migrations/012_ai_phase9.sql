-- Phase 9: Vertex AI (spec §5.2 "Nhân viên, quản trị, AI", §9). Expand only, one transaction, safe to re-run.
--
-- ai_settings: one row (id = 1) whose data is the zod-checked AiSettings
--   (lib/admin/ai-schemas.ts); {} parses to the spec's defaults, so the row is
--   seeded empty and code owns the defaults. updated_at is the save's conflict token.
-- ai_glossary: terms kept as written (keep) or mapped per language (map).
--   Restaurant names are not stored here (R9-6): the translator adds them.
-- ai_usage: one row per call, written BEFORE the call as 'pending' with the
--   cost ceiling, settled after (R9-4). actor_id NULL = not counted per person
--   (bulk jobs, automatic alt text).
-- ai_jobs: bulk translation (spec §9.3), one live job per language.
-- A locale is a code of lib/i18n/site-locales.ts, checked by the app: there is
-- no locales table since 011.

CREATE TABLE IF NOT EXISTS ai_settings (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        REFERENCES staff_user (id) ON DELETE SET NULL
);
INSERT INTO ai_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_glossary (
  id          bigserial   PRIMARY KEY,
  term        text        NOT NULL CHECK (length(btrim(term)) BETWEEN 1 AND 80),
  mode        text        NOT NULL CHECK (mode IN ('keep', 'map')),
  -- NULL: every language (keep); a code: that language only (map needs one).
  locale      text,
  target      text        CHECK (target IS NULL OR length(btrim(target)) BETWEEN 1 AND 80),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        REFERENCES staff_user (id) ON DELETE SET NULL,
  CONSTRAINT ai_glossary_map_target CHECK (mode = 'keep' OR (locale IS NOT NULL AND target IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_glossary_term_locale_idx ON ai_glossary (term, coalesce(locale, ''));

CREATE TABLE IF NOT EXISTS ai_jobs (
  id           bigserial   PRIMARY KEY,
  locale       text        NOT NULL,
  scope        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'paused', 'done', 'cancelled')),
  progress     jsonb       NOT NULL DEFAULT '{"done":0,"failed":0,"remaining":null}'::jsonb,
  error        text,
  attempts     integer     NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by   text        REFERENCES staff_user (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_one_live_idx ON ai_jobs (locale) WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE IF NOT EXISTS ai_usage (
  id            bigserial    PRIMARY KEY,
  at            timestamptz  NOT NULL DEFAULT now(),
  actor_id      text         REFERENCES staff_user (id) ON DELETE SET NULL,
  feature       text         NOT NULL CHECK (feature IN ('translate', 'assist', 'seo', 'alt', 'check')),
  model         text         NOT NULL,
  region        text         NOT NULL,
  input_tokens  integer      NOT NULL DEFAULT 0,
  output_tokens integer      NOT NULL DEFAULT 0,
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  status        text         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  error_code    text,
  job_id        bigint       REFERENCES ai_jobs (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at);
CREATE INDEX IF NOT EXISTS ai_usage_actor_at_idx ON ai_usage (actor_id, at) WHERE actor_id IS NOT NULL;
