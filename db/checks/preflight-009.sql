-- Read-only checks before applying 009_legal_versions.sql to a database at 008 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 009.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-009.sql

SELECT 'migrations 001-008 applied, 009 not' AS check,
       (SELECT count(*) FROM _migrations WHERE name < '009') = 8
       AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name >= '009') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
SELECT 'no legal_versions table yet',
       to_regclass('legal_versions') IS NULL,
       NULL
UNION ALL
-- The seed row names the wording of phase 5; bookings so far stored that version or none.
SELECT 'every booking’s consent_version is the phase-5 policy, or none',
       NOT EXISTS (SELECT 1 FROM reservations WHERE consent_version IS NOT NULL AND consent_version <> '2026-10-03'),
       (SELECT string_agg(DISTINCT consent_version, ', ') FROM reservations WHERE consent_version IS NOT NULL)
UNION ALL
-- Nothing edits the policy before 009 (phase 7 ships the editor with it): the seeded hash is the text in force.
SELECT 'no content_strings row overrides an agreed key yet',
       NOT EXISTS (SELECT 1 FROM content_strings WHERE key LIKE 'legal.%' OR key IN ('booking.privacy_notice', 'booking.consent')),
       (SELECT string_agg(key || ':' || locale, ', ') FROM content_strings WHERE key LIKE 'legal.%' OR key IN ('booking.privacy_notice', 'booking.consent'));
