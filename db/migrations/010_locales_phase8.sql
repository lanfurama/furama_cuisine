-- Phase 8: languages (spec §5.2, §8). Expand only, one transaction, safe to re-run.
--
-- 1. locales.script names a script this build has fonts for (lib/i18n/scripts.ts
--    SCRIPTS; a test compares the two). A language in another script needs fonts,
--    a deploy and a migration widening this CHECK (spec §8: the one limit of
--    "add a language without a developer").
-- 2. A language a social link names in visible_locales cannot be deleted
--    (L8-6): the array has no foreign key. Codes never change after creation
--    (R8-1), so the array never needs rewriting; the trigger only refuses.
-- 3. The privacy policy is versioned per language (T8.3, SEC-3, R8-7): the
--    wording a guest agreed to is (consent_locale, consent_version).
--
-- Phase-7 code runs on this schema until phase-8 code is deployed, so both of
-- its writes still succeed: legal_versions.locale defaults to 'en' (its
-- recordPolicyVersion names no locale), and a booking may carry a consent
-- version without a consent locale (its create.ts writes none; readers take
-- NULL as 'en', and a re-run of this file fills those rows).

ALTER TABLE locales DROP CONSTRAINT IF EXISTS locales_script_check;
ALTER TABLE locales ADD CONSTRAINT locales_script_check
  CHECK (script IN ('latin', 'vietnamese', 'hangul', 'han-simplified', 'japanese'));

CREATE OR REPLACE FUNCTION locales_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM social_links WHERE OLD.code = ANY (visible_locales)) THEN
    RAISE EXCEPTION 'locale % is named by social_links.visible_locales', OLD.code
      USING ERRCODE = 'P0001', HINT = 'Remove the language from those links first.';
  END IF;
  RETURN OLD;
END
$$;
DROP TRIGGER IF EXISTS locales_delete_guard ON locales;
CREATE TRIGGER locales_delete_guard BEFORE DELETE ON locales
  FOR EACH ROW EXECUTE FUNCTION locales_delete_guard();

-- legal_versions: one sequence of versions per language. The seeded row and
-- every row so far are English (only en was ever served).
ALTER TABLE legal_versions ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
DO $legal$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_versions_locale_fk') THEN
    ALTER TABLE legal_versions ADD CONSTRAINT legal_versions_locale_fk
      FOREIGN KEY (locale) REFERENCES locales (code) ON UPDATE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'legal_versions_pkey' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (version)') THEN
    ALTER TABLE legal_versions DROP CONSTRAINT legal_versions_pkey;
    ALTER TABLE legal_versions ADD CONSTRAINT legal_versions_pkey PRIMARY KEY (locale, version);
  END IF;
END
$legal$;

-- reservations: the language of the wording the guest agreed to.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS consent_locale text;
DO $consent$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_consent_locale_fk') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_consent_locale_fk
      FOREIGN KEY (consent_locale) REFERENCES locales (code) ON UPDATE CASCADE;
  END IF;
END
$consent$;
UPDATE reservations SET consent_locale = 'en' WHERE consent_version IS NOT NULL AND consent_locale IS NULL;
-- One way only while phase-7 code still writes bookings: a locale needs a version.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_consent_locale_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_consent_locale_check
  CHECK (consent_locale IS NULL OR consent_version IS NOT NULL);
