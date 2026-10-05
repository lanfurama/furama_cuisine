-- Read-only checks after applying 009_legal_versions.sql (Neon). Every row should say ok = true.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-009.sql

SELECT 'migration 009 recorded' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '009_legal_versions.sql') AS ok,
       NULL AS detail
UNION ALL
SELECT 'one seeded version: 2026-10-03 at the phase-5 hash',
       (SELECT array_agg(version || ' ' || to_char(effective_on, 'YYYY-MM-DD') || ' ' || text_sha256 || ' ' || coalesce(created_by, '-')) FROM legal_versions)
         = ARRAY['2026-10-03 2026-10-03 f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2 seed'],
       (SELECT string_agg(version, ', ' ORDER BY created_at) FROM legal_versions)
UNION ALL
SELECT 'the version and hash CHECKs are in place',
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'legal_versions'::regclass AND contype = 'c') = 2,
       (SELECT string_agg(conname, ', ') FROM pg_constraint WHERE conrelid = 'legal_versions'::regclass AND contype = 'c');
