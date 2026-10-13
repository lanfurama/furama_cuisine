-- Read-only checks before applying 011_ai_phase9.sql to a database at 010 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 011.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-011.sql

SELECT 'migration 010 applied' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '010_locales_phase8.sql') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
-- Not yet applied is the normal case; applied already is a safe re-run (every statement is IF NOT EXISTS).
SELECT 'migration 011 not applied yet (or a re-run)',
       true,
       CASE WHEN EXISTS (SELECT 1 FROM _migrations WHERE name = '011_ai_phase9.sql') THEN 're-run' ELSE 'first run' END
UNION ALL
-- ai_glossary.locale and ai_jobs.locale reference locales (code).
SELECT 'locales has English',
       EXISTS (SELECT 1 FROM locales WHERE code = 'en'),
       (SELECT string_agg(code, ', ' ORDER BY sort_order) FROM locales);
