-- Read-only checks before applying 010_locales_phase8.sql to a database at 009 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 010.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-010.sql

SELECT 'migrations 001-009 applied, 010 not' AS check,
       (SELECT count(*) FROM _migrations WHERE name < '010') = 9
       AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name >= '010') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
-- The new CHECK would refuse a language in a script the fonts do not cover.
SELECT 'every locale is in a script the fonts cover',
       NOT EXISTS (SELECT 1 FROM locales WHERE script NOT IN ('latin', 'vietnamese', 'hangul', 'han-simplified', 'japanese')),
       (SELECT string_agg(code || ':' || script, ', ') FROM locales)
UNION ALL
-- legal_versions gains its locale column here; every existing row becomes English.
SELECT 'legal_versions has no locale column yet',
       NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'legal_versions' AND column_name = 'locale'),
       (SELECT string_agg(version, ', ' ORDER BY created_at) FROM legal_versions)
UNION ALL
-- The 007 CHECK already pairs these; the new consent_locale is filled from consent_version.
SELECT 'every booking’s consent version and time go together',
       NOT EXISTS (SELECT 1 FROM reservations WHERE (consent_version IS NULL) <> (consented_at IS NULL)),
       (SELECT count(*)::text || ' with a consent version' FROM reservations WHERE consent_version IS NOT NULL);
