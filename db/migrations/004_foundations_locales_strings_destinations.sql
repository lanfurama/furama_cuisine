-- Phase 2 foundations shared by the booking and content branches
-- (spec §5.1, §5.2 "Nền tảng"): the language list, translatable UI strings
-- and the destinations. Every statement is idempotent; every seed is
-- ON CONFLICT DO NOTHING so a re-run never overwrites what an editor changed.

-- ── locales ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locales (
  -- Used in URLs: en, vi, zh-hans. Lower case; region/script subtags allowed.
  code          text PRIMARY KEY
                CHECK (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  bcp47         text        NOT NULL CHECK (bcp47 ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  native_name   text        NOT NULL CHECK (native_name <> ''),
  short_label   text        NOT NULL CHECK (short_label <> ''),
  -- Key into SCRIPT_FONTS in code. Not an enum here: the list lives in code.
  script        text        NOT NULL CHECK (script <> ''),
  is_default    boolean     NOT NULL DEFAULT false,
  is_enabled    boolean     NOT NULL DEFAULT false,
  -- Show machine-translated rows to guests for this locale.
  serve_machine boolean     NOT NULL DEFAULT false,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- The default language is always served.
  CONSTRAINT locales_default_enabled CHECK (NOT is_default OR is_enabled)
);

-- At most one default (the index is on a constant, so a second TRUE collides).
CREATE UNIQUE INDEX IF NOT EXISTS locales_single_default_idx
  ON locales ((true)) WHERE is_default;

INSERT INTO locales (code, bcp47, native_name, short_label, script, is_default, is_enabled, sort_order)
VALUES
  ('en', 'en', 'English',    'EN', 'latin',      true,  true,  10),
  ('vi', 'vi', 'Tiếng Việt', 'VI', 'vietnamese', false, false, 20)
ON CONFLICT DO NOTHING;

-- ── content_strings ────────────────────────────────────────────────────────
-- Which keys exist is decided by lib/i18n/registry.ts; this table only holds
-- overrides and translations. Empty at first: readers fall back to the registry.
CREATE TABLE IF NOT EXISTS content_strings (
  key         text        NOT NULL
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  value       text        NOT NULL,  -- ICU MessageFormat
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (key, locale)
);

-- Lookups are per locale (all overrides for one language).
CREATE INDEX IF NOT EXISTS content_strings_locale_idx ON content_strings (locale);

-- ── destinations ───────────────────────────────────────────────────────────
-- Non-translatable columns only; names, addresses and card copy join in
-- destination_i18n in phase 6. card_image_id has no FK yet: `media` does not
-- exist until phase 6, which adds the constraint.
CREATE TABLE IF NOT EXISTS destinations (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  kind           text        NOT NULL CHECK (kind IN ('venue', 'teaser')),
  card_image_id  uuid,
  phone_e164     text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_display  text,
  email          text        CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  map_url        text        CHECK (map_url ~ '^https://'),
  show_in_footer boolean     NOT NULL DEFAULT false,
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  -- A phone number is shown as typed by staff; it needs the dialable form too.
  CONSTRAINT destinations_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL))
);

-- From lib/data.ts (DESTS, DESTINATION_CARDS, CONTACT) and the footer.
-- The footer lists the resort and the dining house only. The shared email
-- (CONTACT.email) belongs to site_settings in phase 6, so it is not copied here.
INSERT INTO destinations (id, kind, phone_e164, phone_display, map_url, show_in_footer, sort_order)
VALUES
  ('resort',       'venue',  '+842366519999', '+84 236 651 9999', 'https://maps.google.com/?q=Furama+Resort+Danang', true,  10),
  ('dining-house', 'venue',  '+84859555759',  '0859 555 759',     NULL,                                               true,  20),
  ('mm',           'venue',  NULL,            NULL,               NULL,                                               false, 30),
  ('future',       'teaser', NULL,            NULL,               NULL,                                               false, 40)
ON CONFLICT DO NOTHING;

-- restaurants.destination already holds these ids as text. Constrain it now so
-- a typo cannot create an orphan; phase 6 adds destination_id and phase 10
-- drops this column together with its constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_destination_fk') THEN
    ALTER TABLE restaurants
      ADD CONSTRAINT restaurants_destination_fk
      FOREIGN KEY (destination) REFERENCES destinations (id) ON UPDATE CASCADE;
  END IF;
END $$;
