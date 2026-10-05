-- Phase 7: the privacy policy's version moves from a code constant
-- (lib/legal.ts PRIVACY_POLICY_VERSION) to the database, because editors now
-- change the policy text in /admin/content/legal (spec §7.2, §11; phase-5
-- ledger T8.2: "the version becomes the time of the save").
--
-- Append-only: one row per wording a guest could agree to. A save that changes
-- the English text of any key the guest agrees to (the policy page, the
-- drawer's notice and the consent label: lib/legal.ts AGREED_KEYS) adds a row;
-- a save that leaves that text as it was adds none. reservations.consent_version
-- names the row in force when the booking was made, so the exact wording stays
-- answerable from text_sha256 and the audit log.
--
-- Expand only, one transaction, safe to re-run.

CREATE TABLE IF NOT EXISTS legal_versions (
  -- What reservations.consent_version stores (≤ 40 there): the Da Nang date of
  -- the save, with ".2", ".3" … for later saves on the same day.
  version      text        PRIMARY KEY CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  -- The date the policy page prints as "Last updated".
  effective_on date        NOT NULL,
  -- sha256 of JSON [[key, English text], …] over AGREED_KEYS, as lib/legal.ts policyTextHash computes it.
  text_sha256  text        NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text
);

-- The wording in force since phase 5 (the registry defaults; lib/legal.test.ts pins the same pair).
INSERT INTO legal_versions (version, effective_on, text_sha256, created_at, created_by)
VALUES ('2026-10-03', DATE '2026-10-03', 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2',
        TIMESTAMPTZ '2026-10-03 00:00:00+07', 'seed')
ON CONFLICT DO NOTHING;
