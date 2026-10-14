-- Read-only checks after applying 012_ai_phase9.sql (Neon). Every row should say ok = true.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-012.sql

SELECT 'migration 012 recorded' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '012_ai_phase9.sql') AS ok,
       NULL AS detail
UNION ALL
SELECT 'the four AI tables exist',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name IN ('ai_settings', 'ai_glossary', 'ai_usage', 'ai_jobs')) = 4,
       NULL
UNION ALL
SELECT 'ai_settings holds exactly one row',
       (SELECT count(*) FROM ai_settings) = 1,
       (SELECT count(*)::text || ' row(s)' FROM ai_settings)
UNION ALL
SELECT 'one live bulk-translation job per language',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ai_jobs_one_live_idx'),
       NULL
UNION ALL
SELECT 'a mapped glossary term needs a language and a target',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_glossary_map_target'),
       NULL;
