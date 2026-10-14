-- Read-only checks before applying 012_ai_phase9.sql to a database at 011 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 012.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-012.sql

SELECT 'migration 011 applied' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '011_drop_locales.sql') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
-- Not yet applied is the normal case; applied already is a safe re-run (every statement is IF NOT EXISTS).
SELECT 'migration 012 not applied yet (or a re-run)',
       true,
       CASE WHEN EXISTS (SELECT 1 FROM _migrations WHERE name = '012_ai_phase9.sql') THEN 're-run' ELSE 'first run' END;
