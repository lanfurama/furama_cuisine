-- Read-only checks after applying 010_locales_phase8.sql (Neon). Every row should say ok = true.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-010.sql

SELECT 'migration 010 recorded' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '010_locales_phase8.sql') AS ok,
       NULL AS detail
UNION ALL
SELECT 'locales.script is limited to the scripts the fonts cover',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locales_script_check'),
       NULL
UNION ALL
SELECT 'deleting a language a social link names is refused',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'locales_delete_guard' AND tgrelid = 'locales'::regclass),
       NULL
UNION ALL
SELECT 'legal_versions is keyed by (locale, version), every row English so far',
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'legal_versions_pkey') = 'PRIMARY KEY (locale, version)'
       AND NOT EXISTS (SELECT 1 FROM legal_versions WHERE locale <> 'en'),
       (SELECT string_agg(locale || ' ' || version, ', ' ORDER BY created_at) FROM legal_versions)
UNION ALL
SELECT 'every booking with a consent version has its consent locale',
       NOT EXISTS (SELECT 1 FROM reservations WHERE consent_version IS NOT NULL AND consent_locale IS NULL),
       (SELECT string_agg(DISTINCT consent_locale, ', ') FROM reservations);
