-- The languages move to code (owner, 2026-10-14): lib/i18n/site-locales.ts
-- lists them, the guest site, the proxy and the SQL read that list, and the
-- admin has no language screen. One transaction, safe to re-run.
--
-- 1. Every locale column keeps its values and loses its foreign key to
--    locales: a code is checked by the app against the list (a save takes
--    only a listed language; a guest page only an enabled one).
-- 2. The locales table goes, with the trigger that guarded its deletes.
-- 3. social_links.visible_locales goes: every link shows in every language.
--
-- Deploy the code first: the phase-8 code reads the table, the new code does
-- not (README, "Migration 011").

ALTER TABLE content_strings           DROP CONSTRAINT IF EXISTS content_strings_locale_fkey;
ALTER TABLE media_i18n                DROP CONSTRAINT IF EXISTS media_i18n_locale_fkey;
ALTER TABLE destination_i18n          DROP CONSTRAINT IF EXISTS destination_i18n_locale_fkey;
ALTER TABLE cuisine_i18n              DROP CONSTRAINT IF EXISTS cuisine_i18n_locale_fkey;
ALTER TABLE restaurant_i18n           DROP CONSTRAINT IF EXISTS restaurant_i18n_locale_fkey;
ALTER TABLE restaurant_highlight_i18n DROP CONSTRAINT IF EXISTS restaurant_highlight_i18n_locale_fkey;
ALTER TABLE experience_i18n           DROP CONSTRAINT IF EXISTS experience_i18n_locale_fkey;
ALTER TABLE story_i18n                DROP CONSTRAINT IF EXISTS story_i18n_locale_fkey;
ALTER TABLE offer_i18n                DROP CONSTRAINT IF EXISTS offer_i18n_locale_fkey;
ALTER TABLE nav_item_i18n             DROP CONSTRAINT IF EXISTS nav_item_i18n_locale_fkey;
ALTER TABLE closure_i18n              DROP CONSTRAINT IF EXISTS closure_i18n_locale_fkey;
ALTER TABLE reservations              DROP CONSTRAINT IF EXISTS reservations_locale_fkey;
ALTER TABLE reservations              DROP CONSTRAINT IF EXISTS reservations_consent_locale_fk;
ALTER TABLE notification_recipients   DROP CONSTRAINT IF EXISTS notification_recipients_locale_fkey;
ALTER TABLE email_outbox              DROP CONSTRAINT IF EXISTS email_outbox_locale_fkey;
ALTER TABLE legal_versions            DROP CONSTRAINT IF EXISTS legal_versions_locale_fk;

-- No CASCADE: a foreign key this file does not know about stops it here.
DROP TABLE IF EXISTS locales;
DROP FUNCTION IF EXISTS locales_delete_guard();

ALTER TABLE social_links DROP COLUMN IF EXISTS visible_locales;
