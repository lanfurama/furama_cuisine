-- The brand is now Furama Dining World (2026-10-15). The privacy policy and
-- the consent label name it, so the agreed English text changed: a new
-- legal_versions row records it (lib/legal.test.ts pins the same pair).
-- Only English has versions; no other language has its own agreed text.
-- Adds one row, safe to re-run.

INSERT INTO legal_versions (locale, version, effective_on, text_sha256, created_at, created_by)
VALUES ('en', '2026-10-15', DATE '2026-10-15', '77926aacc33be47d2aa8dc6c07ed2b9355ff0a3b954177a3628c1064acd0a003',
        TIMESTAMPTZ '2026-10-15 00:00:00+07', 'migration 015')
ON CONFLICT DO NOTHING;
