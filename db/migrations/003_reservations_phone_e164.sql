-- Normalised phone numbers for duplicate detection and lookup. `phone` keeps
-- what the guest typed; `phone_e164` is the canonical form the app writes
-- (libphonenumber, Vietnamese default region).

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS phone_e164 text;

-- Rows written before this migration get a rough Vietnamese normalisation:
-- 84… → +84…, 0… → +84…, anything else gains a leading +.
UPDATE reservations
   SET phone_e164 = CASE
         WHEN p.d LIKE '84%' THEN '+' || p.d
         WHEN p.d LIKE '0%'  THEN '+84' || substr(p.d, 2)
         ELSE '+' || p.d
       END
  FROM (SELECT id AS rid, regexp_replace(phone, '\D', '', 'g') AS d FROM reservations) p
 WHERE reservations.id = p.rid
   AND reservations.phone_e164 IS NULL;

-- Two active bookings can collapse onto one key once phones are normalised.
-- Stop with a readable message rather than a bare unique violation.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM reservations
     WHERE status IN ('requested', 'confirmed')
     GROUP BY restaurant_id, reserved_on, reserved_at, phone_e164
    HAVING count(*) > 1
  ) dupes;
  IF n > 0 THEN
    RAISE EXCEPTION '% active booking group(s) share a phone once normalised; cancel the extras, then migrate again', n;
  END IF;
END $$;

ALTER TABLE reservations ALTER COLUMN phone_e164 SET NOT NULL;

-- Replaces the raw-phone index: one active request per table and number.
DROP INDEX IF EXISTS reservations_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_dedupe_v2_idx
  ON reservations (restaurant_id, reserved_on, reserved_at, phone_e164)
  WHERE status IN ('requested', 'confirmed');
