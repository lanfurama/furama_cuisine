-- Phase 6: guest content moves into the database (spec §5.1, §5.2 "Nội dung
-- (đợt 6)" and "File", §6.4, §14.1 row 6).
--
-- Expand only, one transaction, safe to re-run. New: media (+ media_i18n),
-- destination_i18n, cuisines (+ cuisine_i18n), restaurant_i18n,
-- restaurant_cuisines, restaurant_highlights (+ i18n), sections, hero_slides,
-- experiences (+ i18n), stories (+ i18n), offers (+ offer_i18n), nav_items
-- (+ nav_item_i18n), social_links. Extended: restaurants, destinations
-- (card_image_id gets its FK), site_settings (ADD COLUMN IF NOT EXISTS, never
-- CREATE: phase 5 created it), reservations (offer_id gets its FK).
--
-- The seed is exactly what the guest site shows at 8fe98f5: lib/data.ts, the
-- copy written into the components, and what 002/004 already put in the
-- database (copied with INSERT … SELECT, so Neon's own values carry over).
-- test/integration/content-seed.test.ts compares every row with a frozen copy
-- of that content and re-measures every file in public/assets. Section copy and
-- UI text are NOT seeded: they are registry keys (lib/i18n/registry.ts), whose
-- defaults apply while content_strings has no row (spec §8).
--
-- Seeds: every INSERT is ON CONFLICT DO NOTHING (spec §5.1 item 7). List tables
-- take fixed ids (OVERRIDING SYSTEM VALUE) so their *_i18n rows can name them;
-- the identity sequences are moved past them at the end, never back. Seeded
-- translations are status 'reviewed', origin 'seed'.
-- Re-running: scripts/migrate.mjs records each file it applies, by name, and
-- never runs one again; only a manual `psql -f` repeats this file. Such a run
-- keeps every value an editor set: no INSERT replaces a row, and each UPDATE
-- fills only columns that are still NULL, except Tàya House's page switch (see
-- there). A list (cuisines, highlights, hero slides, experiences, stories,
-- offers, nav items, social links) is seeded only while it is empty, so a
-- seeded row an editor deleted stays deleted with its translations, unless the
-- whole list was emptied. Any other seeded row an editor deleted does come
-- back: a translation or alt text whose parent row is still there, a static
-- file's media row, and a restaurant's cuisine links once it has none (read
-- again from restaurants.cuisines). So does a picture an editor emptied, and
-- Tàya House's page text if all five of its fields were emptied.
-- Translatable text is never blank (CHECK btrim(x) <> ''): NULL means "fall back
-- to the default language" (spec §5.1 item 5), so blank must not mean "shown".
-- Text CHECKs are generous backstops; the design limits (spec §6.5) are the
-- admin's (phase 7), except nav_item_i18n.label ≤ 18, which the spec puts here.

-- ── Guards ────────────────────────────────────────────────────────────────
-- Nothing has written reservations.offer_id yet (phase 4 created it for this
-- phase). Offers 1–3 are seeded below, so a stray value would silently point at
-- one of them: stop instead.
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'reservations' AND constraint_name = 'reservations_offer_id_fkey') THEN
    SELECT count(*) INTO n FROM reservations WHERE offer_id IS NOT NULL;
    IF n > 0 THEN
      RAISE EXCEPTION '% booking(s) already carry an offer_id before offers exist; set them to NULL, then migrate again', n;
    END IF;
  END IF;
END $$;

-- ── media → media_i18n ────────────────────────────────────────────────────
-- 'static': a file in public/, served at url = pathname (/assets/…). 'blob':
-- a Vercel Blob upload (phase 7). Images carry their pixel size (next/image
-- needs it); PDFs carry none. blur_data_url stays NULL for the static files:
-- the guest pages draw no blur placeholder today, and drawing one would change
-- them (spec §14.1 row 6 acceptance); phase 7 fills it on upload.
CREATE TABLE IF NOT EXISTS media (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage       text        NOT NULL CHECK (storage IN ('static', 'blob')),
  url           text        NOT NULL CHECK (length(url) <= 2000),
  pathname      text        NOT NULL CHECK (length(pathname) <= 500),
  content_type  text        NOT NULL
                CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf')),
  width         integer     CHECK (width BETWEEN 1 AND 20000),
  height        integer     CHECK (height BETWEEN 1 AND 20000),
  bytes         integer     NOT NULL CHECK (bytes BETWEEN 1 AND 15728640),  -- 15 MB upload cap (spec §11)
  blur_data_url text        CHECK (blur_data_url ~ '^data:image/(jpeg|png|webp);base64,' AND length(blur_data_url) <= 4000),
  -- alt="" wherever it is shown, and the phase-9 alt generator skips it.
  is_decorative boolean     NOT NULL DEFAULT false,
  -- Soft delete; media-sweep removes the file later. Content references keep RESTRICT either way.
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- registerMedia upserts by pathname (spec §11).
  CONSTRAINT media_pathname_key UNIQUE (pathname),
  CONSTRAINT media_static_path CHECK (
    storage <> 'static' OR (url = pathname AND pathname ~ '^/assets/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp|avif|pdf)$')
  ),
  CONSTRAINT media_blob_url CHECK (storage <> 'blob' OR url ~ '^https://'),
  CONSTRAINT media_dimensions CHECK (
    ((content_type = 'application/pdf') = (width IS NULL)) AND ((width IS NULL) = (height IS NULL))
  )
);

-- Alt text per language; a row exists only when there is alt text. Not for PDFs.
CREATE TABLE IF NOT EXISTS media_i18n (
  media_id    uuid        NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  alt         text        NOT NULL CHECK (btrim(alt) <> '' AND char_length(alt) <= 250),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (media_id, locale)
);

-- Every file in public/assets, measured by `node scripts/measure-assets.mjs`
-- (the VALUES block is its output, verbatim). Decorative: the images the
-- components draw with alt="" today: cuisine chips (the label is beside them),
-- destination and story cards (their text is on or under them), the heritage
-- background, and hero slides 2 and 3.
INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, is_decorative)
SELECT 'static', v.pathname, v.pathname, v.content_type, v.width, v.height, v.bytes,
       v.pathname ~ '^/assets/(cuisine|dest|story)-'
       OR v.pathname IN ('/assets/heritage.jpg', '/assets/hero-taya.jpg', '/assets/hero-indochine.jpg')
  FROM (VALUES
    ('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833),
    ('/assets/cuisine-cafe-lounge.jpg', 'image/jpeg', 45, 45, 7915),
    ('/assets/cuisine-hotpot.jpg', 'image/jpeg', 45, 45, 8121),
    ('/assets/cuisine-international.jpg', 'image/jpeg', 45, 45, 8010),
    ('/assets/cuisine-italian.jpg', 'image/jpeg', 360, 360, 36591),
    ('/assets/cuisine-japanese.jpg', 'image/jpeg', 45, 45, 8019),
    ('/assets/cuisine-steak-grill.jpg', 'image/jpeg', 360, 360, 35685),
    ('/assets/cuisine-thai.jpg', 'image/jpeg', 360, 360, 36597),
    ('/assets/cuisine-vietnamese.jpg', 'image/jpeg', 360, 360, 33769),
    ('/assets/dest-dining-house.jpg', 'image/jpeg', 616, 960, 66715),
    ('/assets/dest-future.jpg', 'image/jpeg', 194, 302, 23552),
    ('/assets/dest-mm.jpg', 'image/jpeg', 194, 302, 30721),
    ('/assets/dest-resort.jpg', 'image/jpeg', 194, 302, 21681),
    ('/assets/heritage.jpg', 'image/jpeg', 908, 322, 76454),
    ('/assets/hero-beach.jpg', 'image/jpeg', 906, 515, 101208),
    ('/assets/hero-hall-m.jpg', 'image/jpeg', 245, 378, 28455),
    ('/assets/hero-indochine.jpg', 'image/jpeg', 125, 94, 13001),
    ('/assets/hero-taya.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/r-cafe-indochine.jpg', 'image/jpeg', 960, 720, 163565),
    ('/assets/r-chaoshan-hotpot.jpg', 'image/jpeg', 125, 94, 12832),
    ('/assets/r-danaksara.jpg', 'image/jpeg', 125, 94, 12923),
    ('/assets/r-don-ciprianis.jpg', 'image/jpeg', 960, 720, 165717),
    ('/assets/r-hai-van-lounge.jpg', 'image/jpeg', 126, 94, 12757),
    ('/assets/r-hura-izakaya.jpg', 'image/jpeg', 960, 720, 134441),
    ('/assets/r-pho-cuon.jpg', 'image/jpeg', 960, 720, 120080),
    ('/assets/r-taya-house.jpg', 'image/jpeg', 960, 720, 178214),
    ('/assets/r-thai-siam-kitchen.jpg', 'image/jpeg', 960, 720, 161143),
    ('/assets/r-the-fan.jpg', 'image/jpeg', 960, 720, 162477),
    ('/assets/r-v-senses-cafe.jpg', 'image/jpeg', 960, 720, 154173),
    ('/assets/r-yum-food-village.jpg', 'image/jpeg', 126, 94, 12806),
    ('/assets/story-buffet-gala.jpg', 'image/jpeg', 816, 600, 153134),
    ('/assets/story-dh-opening.jpg', 'image/jpeg', 816, 600, 101681),
    ('/assets/story-thai-siam.jpg', 'image/jpeg', 816, 600, 121113),
    ('/assets/story-the-fan.jpg', 'image/jpeg', 816, 600, 61351),
    ('/assets/taya-class.jpg', 'image/jpeg', 960, 720, 170931),
    ('/assets/taya-garden.jpg', 'image/jpeg', 960, 720, 181719),
    ('/assets/taya-hero.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/taya-lounge.jpg', 'image/jpeg', 960, 720, 152655),
    ('/assets/taya-stay.jpg', 'image/jpeg', 960, 720, 159098)
  ) AS v(pathname, content_type, width, height, bytes)
ON CONFLICT (pathname) DO NOTHING;

-- The alt text the components write today. hero-hall-m.jpg is slide 1's phone
-- crop (one <picture>, one alt). The film modal shows hero-beach.jpg as its
-- poster with alt="": that is the poster's role there, not the file's, so the
-- component keeps alt="" for it.
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', v.alt, 'seed'
  FROM (VALUES
    ('/assets/chef.jpg',        'A Furama chef at work'),
    ('/assets/hero-beach.jpg',  'Dining at Furama Cuisine'),
    ('/assets/hero-hall-m.jpg', 'Dining at Furama Cuisine'),
    ('/assets/taya-hero.jpg',   'Tàya House'),
    ('/assets/taya-class.jpg',  'Cooking class photo'),
    ('/assets/taya-lounge.jpg', 'Tàya House interior'),
    ('/assets/taya-garden.jpg', 'Lagoon Garden'),
    ('/assets/taya-stay.jpg',   'Cooking class & stay')
  ) AS v(pathname, alt)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- A restaurant card's alt is the restaurant's name (RestaurantCard.tsx).
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', r.name, 'seed'
  FROM restaurants r
  JOIN media m ON m.pathname = '/assets/r-' || r.id || '.jpg'
ON CONFLICT DO NOTHING;

-- ── destinations (004) → destination_i18n ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'destinations_card_image_id_fkey') THEN
    ALTER TABLE destinations
      ADD CONSTRAINT destinations_card_image_id_fkey
      FOREIGN KEY (card_image_id) REFERENCES media (id) ON DELETE RESTRICT;
  END IF;
END $$;

UPDATE destinations d
   SET card_image_id = m.id
  FROM media m
 WHERE d.card_image_id IS NULL
   AND m.pathname = '/assets/dest-' || d.id || '.jpg';

-- name: dropdowns, the footer line, "More at {name}". card_*: the two-line
-- title and blurb of the home card. address: the footer line.
CREATE TABLE IF NOT EXISTS destination_i18n (
  destination_id text        NOT NULL REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  name           text        CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  card_title_1   text        CHECK (btrim(card_title_1) <> '' AND char_length(card_title_1) <= 40),
  card_title_2   text        CHECK (btrim(card_title_2) <> '' AND char_length(card_title_2) <= 40),
  card_blurb_1   text        CHECK (btrim(card_blurb_1) <> '' AND char_length(card_blurb_1) <= 60),
  card_blurb_2   text        CHECK (btrim(card_blurb_2) <> '' AND char_length(card_blurb_2) <= 60),
  address        text        CHECK (btrim(address) <> '' AND char_length(address) <= 200),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (destination_id, locale)
);

-- DESTS, DESTINATION_CARDS (lib/data.ts) and the footer's addresses
-- (Footer.tsx). The teaser has no name today: its card is not a link and no
-- dropdown lists it.
INSERT INTO destination_i18n (destination_id, locale, name, card_title_1, card_title_2, card_blurb_1, card_blurb_2, address, origin)
SELECT v.destination_id, 'en', v.name, v.card_title_1, v.card_title_2, v.card_blurb_1, v.card_blurb_2, v.address, 'seed'
  FROM (VALUES
    ('resort',       'Furama Resort Danang',  'Furama',    'Resort Danang', 'Iconic beachfront dining', 'since 1997',     '103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng'),
    ('dining-house', 'Furama Dining House',   'Furama',    'Dining House',  '4 floors · 4 flavours',    '1 night out',    '73 Trần Bạch Đằng, An Thượng'),
    ('mm',           'Furama MM Supercenter', 'Furama MM', 'Supercenter',   'Everyday dining',          'for everyone',   NULL),
    ('future',       NULL,                    'Future',    'Locations',     'Bringing great food',      'to more places', NULL)
  ) AS v(destination_id, name, card_title_1, card_title_2, card_blurb_1, card_blurb_2, address)
  JOIN destinations d ON d.id = v.destination_id
ON CONFLICT DO NOTHING;

-- ── cuisines → cuisine_i18n ───────────────────────────────────────────────
-- The id is the slug: the filter key (spec §6.3 item 2) and, today, the image name.
CREATE TABLE IF NOT EXISTS cuisines (
  id           text        PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id) <= 40),
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS cuisine_i18n (
  cuisine_id  text        NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  label       text        CHECK (btrim(label) <> '' AND char_length(label) <= 40),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (cuisine_id, locale)
);

-- CUISINES (lib/data.ts), in its order: the rail, the dropdowns and the search chips.
INSERT INTO cuisines (id, image_id, sort_order)
SELECT v.id, m.id, v.sort_order
  FROM (VALUES ('vietnamese', 10), ('italian', 20), ('thai', 30), ('japanese', 40),
               ('steak-grill', 50), ('hotpot', 60), ('international', 70), ('cafe-lounge', 80))
       AS v(id, sort_order)
  JOIN media m ON m.pathname = '/assets/cuisine-' || v.id || '.jpg'
 WHERE NOT EXISTS (SELECT 1 FROM cuisines)
ON CONFLICT DO NOTHING;

INSERT INTO cuisine_i18n (cuisine_id, locale, label, origin)
SELECT v.cuisine_id, 'en', v.label, 'seed'
  FROM (VALUES ('vietnamese', 'Vietnamese'), ('italian', 'Italian'), ('thai', 'Thai'), ('japanese', 'Japanese'),
               ('steak-grill', 'Steak & Grill'), ('hotpot', 'Hotpot'), ('international', 'International'),
               ('cafe-lounge', 'Café & Lounge'))
       AS v(cuisine_id, label)
  JOIN cuisines c ON c.id = v.cuisine_id
ON CONFLICT DO NOTHING;

-- ── restaurants: the content columns ──────────────────────────────────────
-- name stays here, untranslated (spec §3). slug is the URL segment, the same
-- in every language. phone_*/map_url: NULL falls back to the destination's
-- (spec §6.4). archived_at: hidden for good while its bookings keep the row.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS slug            text        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  ADD COLUMN IF NOT EXISTS destination_id  text        REFERENCES destinations (id) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS card_image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS detail_image_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS og_image_id     uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS phone_e164      text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN IF NOT EXISTS phone_display   text        CHECK (btrim(phone_display) <> '' AND char_length(phone_display) <= 30),
  ADD COLUMN IF NOT EXISTS map_url         text        CHECK (map_url ~ '^https://' AND length(map_url) <= 2000),
  ADD COLUMN IF NOT EXISTS has_detail_page boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_published    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at     timestamptz;

UPDATE restaurants SET slug = id WHERE slug IS NULL;
UPDATE restaurants SET destination_id = destination WHERE destination_id IS NULL;

UPDATE restaurants r
   SET card_image_id = m.id
  FROM media m
 WHERE r.card_image_id IS NULL
   AND m.pathname = '/assets/r-' || r.id || '.jpg';

-- DETAIL_PAGE_IDS: only Tàya House has a page today. Guarded on the portrait: a
-- re-run leaves the switch as an editor set it while the portrait is there, but
-- switches the page back on if the portrait was removed as well.
UPDATE restaurants r
   SET detail_image_id = m.id, has_detail_page = true
  FROM media m
 WHERE r.id = 'taya-house'
   AND r.detail_image_id IS NULL
   AND m.pathname = '/assets/taya-hero.jpg';

ALTER TABLE restaurants
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN destination_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_slug_key ON restaurants (slug);

ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_phone_pair;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL));
-- A page draws its portrait (spec §6.4: the admin requires it when the page is on).
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_detail_image;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_detail_image CHECK (NOT has_detail_page OR detail_image_id IS NOT NULL);
-- A card a guest can see draws its picture.
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_published_card;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_published_card CHECK (NOT is_published OR card_image_id IS NOT NULL);

-- The phase-1 columns this phase replaces stay until phase 10 drops them
-- (spec §14.1 row 10). From here nothing reads them, and a restaurant added in
-- phase 7 need not fill the two that were NOT NULL (cuisines, meals and
-- slot_capacity have defaults already).
ALTER TABLE restaurants
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN destination DROP NOT NULL;
COMMENT ON COLUMN restaurants.type IS 'Phase 1, replaced by restaurant_i18n.type_label; dropped in phase 10.';
COMMENT ON COLUMN restaurants.destination IS 'Phase 1, replaced by destination_id; dropped in phase 10.';
COMMENT ON COLUMN restaurants.cuisines IS 'Phase 1, replaced by restaurant_cuisines; dropped in phase 10.';
COMMENT ON COLUMN restaurants.meals IS 'Phase 1, replaced by service_periods (006); dropped in phase 10.';
COMMENT ON COLUMN restaurants.slot_capacity IS 'Phase 1, replaced by service_periods.covers_per_slot (006); dropped in phase 10.';

-- ── restaurant_i18n ───────────────────────────────────────────────────────
-- story_label and highlights_title: NULL uses the registry's default ("Brand
-- Story", "At {name}"). The menu is one PDF per language: an uploaded file
-- (phase 7) or a link, never both.
CREATE TABLE IF NOT EXISTS restaurant_i18n (
  restaurant_id     text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale            text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  type_label        text        CHECK (btrim(type_label) <> '' AND char_length(type_label) <= 60),
  detail_kicker     text        CHECK (btrim(detail_kicker) <> '' AND char_length(detail_kicker) <= 100),
  story_label       text        CHECK (btrim(story_label) <> '' AND char_length(story_label) <= 40),
  story             text        CHECK (btrim(story) <> '' AND char_length(story) <= 1500),
  highlights_title  text        CHECK (btrim(highlights_title) <> '' AND char_length(highlights_title) <= 60),
  menu_pdf_media_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  menu_pdf_url      text        CHECK (menu_pdf_url ~ '^https://' AND length(menu_pdf_url) <= 2000),
  seo_title         text        CHECK (btrim(seo_title) <> '' AND char_length(seo_title) <= 120),
  seo_description   text        CHECK (btrim(seo_description) <> '' AND char_length(seo_description) <= 320),
  status            text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin            text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model          text,
  source_hash       text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  PRIMARY KEY (restaurant_id, locale),
  CONSTRAINT restaurant_i18n_one_menu CHECK (menu_pdf_media_id IS NULL OR menu_pdf_url IS NULL)
);

-- Every restaurant's type label, copied from the column the cards read today.
INSERT INTO restaurant_i18n (restaurant_id, locale, type_label, origin)
SELECT r.id, 'en', r.type, 'seed'
  FROM restaurants r
 WHERE r.type IS NOT NULL
ON CONFLICT DO NOTHING;

-- Tàya House's page (TayaHero.tsx, DETAIL_SEO and CONTACT.tariffPdf in lib/data.ts).
-- Its type label row exists by now, so these columns are filled in place; the
-- IS NULL guard keeps a re-run off an edited page.
UPDATE restaurant_i18n
   SET detail_kicker   = 'A Wellness Dining Home · Furama Resort Danang',
       story           = 'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
       menu_pdf_url    = 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
       seo_title       = 'Tàya House — Furama Cuisine',
       seo_description = 'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.'
 WHERE restaurant_id = 'taya-house'
   AND locale = 'en'
   AND detail_kicker IS NULL AND story IS NULL AND menu_pdf_url IS NULL AND seo_title IS NULL AND seo_description IS NULL;

-- ── restaurant_cuisines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_cuisines (
  restaurant_id text    NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- A cuisine in use cannot be deleted; detach it from its restaurants first.
  cuisine_id    text    NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sort_order    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE INDEX IF NOT EXISTS restaurant_cuisines_cuisine_idx ON restaurant_cuisines (cuisine_id);

-- restaurants.cuisines holds English labels (002). A label with no cuisine
-- stops the migration with its name, as cuisineSlug() throws today, instead of
-- dropping out of every filter. Only restaurants still to be seeded count.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT c.label, ', ') INTO bad
    FROM restaurants r
    CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
   WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM cuisine_i18n ci WHERE ci.locale = 'en' AND ci.label = c.label);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'restaurants.cuisines holds label(s) with no cuisine: %; add them to migration 008''s cuisines, then migrate again', bad;
  END IF;
END $$;

-- In the array's order (Yum Food Village: International, Vietnamese, Thai).
INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id, sort_order)
SELECT r.id, ci.cuisine_id, c.n * 10
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.cuisines) WITH ORDINALITY AS c(label, n)
  JOIN cuisine_i18n ci ON ci.locale = 'en' AND ci.label = c.label
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
ON CONFLICT DO NOTHING;

-- ── restaurant_highlights → restaurant_highlight_i18n ─────────────────────
-- The cards of a detail page (spec §6.4); 0 hides the section.
CREATE TABLE IF NOT EXISTS restaurant_highlights (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  image_id      uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order    integer     NOT NULL DEFAULT 0,
  is_published  boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

CREATE INDEX IF NOT EXISTS restaurant_highlights_restaurant_idx ON restaurant_highlights (restaurant_id, sort_order, id);

CREATE TABLE IF NOT EXISTS restaurant_highlight_i18n (
  highlight_id bigint      NOT NULL REFERENCES restaurant_highlights (id) ON DELETE CASCADE,
  locale       text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title        text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  detail       text        CHECK (btrim(detail) <> '' AND char_length(detail) <= 200),
  status       text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin       text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model     text,
  source_hash  text,
  reviewed_by  text,
  reviewed_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (highlight_id, locale)
);

-- TAYA_EXPERIENCES (lib/data.ts); their alt text went into media_i18n above.
INSERT INTO restaurant_highlights (id, restaurant_id, image_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, 'taya-house', m.id, v.sort_order
  FROM (VALUES (1, '/assets/taya-class.jpg', 10), (2, '/assets/taya-lounge.jpg', 20),
               (3, '/assets/taya-garden.jpg', 30), (4, '/assets/taya-stay.jpg', 40))
       AS v(id, pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_highlights)
ON CONFLICT DO NOTHING;

INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail, origin)
SELECT v.highlight_id, 'en', v.title, v.detail, 'seed'
  FROM (VALUES
    (1, 'Vietnamese Cooking Class', 'Daily at 11:00 or 14:00 · VND 799,000++ per guest'),
    (2, 'Healthy Drinks & Snacks',  'Served in the garden house, daily 10:00–22:00'),
    (3, 'Private Gatherings',       'Outdoor celebrations and intimate events among the palms'),
    (4, 'Cooking Class & Stay',     'From USD 420 · 2 nights for 2 guests')
  ) AS v(highlight_id, title, detail)
  JOIN restaurant_highlights h ON h.id = v.highlight_id
ON CONFLICT DO NOTHING;

-- ── sections ──────────────────────────────────────────────────────────────
-- The home page's fixed blocks, in the design's order (no reordering: not a
-- page builder, spec §2). Their copy is registry keys; this row holds the
-- switch, the picture and the link. restaurants can never be hidden: the hero,
-- the cuisines, the finder and the tab bar all scroll to it (spec §6.5).
CREATE TABLE IF NOT EXISTS sections (
  key        text        PRIMARY KEY CHECK (key IN ('hero', 'film', 'finder', 'cuisines', 'restaurants', 'destinations',
                                                    'experiences', 'heritage', 'stories', 'offers', 'booking_bar')),
  is_visible boolean     NOT NULL DEFAULT true,
  image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  link_url   text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT sections_restaurants_visible CHECK (key <> 'restaurants' OR is_visible),
  -- The film plays a YouTube or Vimeo video; phase 7 parses the id.
  CONSTRAINT sections_film_video CHECK (
    key <> 'film' OR link_url ~ '^https://((www\.|m\.)?youtube\.com|youtu\.be|(player\.)?vimeo\.com)/'
  )
);

-- film: today's poster and no video yet ("THE FILM · COMING SOON").
-- heritage: CONTACT.story. experiences: its side picture.
INSERT INTO sections (key, image_id, link_url)
SELECT v.key, m.id, v.link_url
  FROM (VALUES ('hero', NULL, NULL),
               ('film', '/assets/hero-beach.jpg', NULL),
               ('finder', NULL, NULL),
               ('cuisines', NULL, NULL),
               ('restaurants', NULL, NULL),
               ('destinations', NULL, NULL),
               ('experiences', '/assets/chef.jpg', NULL),
               ('heritage', '/assets/heritage.jpg', 'https://furamavietnam.com/the-resort/'),
               ('stories', NULL, NULL),
               ('offers', NULL, NULL),
               ('booking_bar', NULL, NULL))
       AS v(key, pathname, link_url)
  LEFT JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- ── hero_slides ───────────────────────────────────────────────────────────
-- Alt text is the image's (media_i18n). image_mobile_id: the phone crop, used
-- by the first published slide only (phones show one slide).
CREATE TABLE IF NOT EXISTS hero_slides (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id        uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  image_mobile_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- HERO_SLIDES (lib/data.ts) and the phone crop of Hero.tsx.
INSERT INTO hero_slides (id, image_id, image_mobile_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, mm.id, v.sort_order
  FROM (VALUES (1, '/assets/hero-beach.jpg', '/assets/hero-hall-m.jpg', 10),
               (2, '/assets/hero-taya.jpg', NULL, 20),
               (3, '/assets/hero-indochine.jpg', NULL, 30))
       AS v(id, pathname, mobile_pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
  LEFT JOIN media mm ON mm.pathname = v.mobile_pathname
 WHERE NOT EXISTS (SELECT 1 FROM hero_slides)
ON CONFLICT DO NOTHING;

-- ── experiences → experience_i18n ─────────────────────────────────────────
-- link_url NULL: the row links nowhere, as today (#experiences); the owner has
-- yet to give the targets (spec §15 item 16).
CREATE TABLE IF NOT EXISTS experiences (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_url     text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS experience_i18n (
  experience_id bigint      NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title         text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  blurb         text        CHECK (btrim(blurb) <> '' AND char_length(blurb) <= 200),
  status        text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin        text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model      text,
  source_hash   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (experience_id, locale)
);

-- EXPERIENCES (lib/data.ts).
INSERT INTO experiences (id, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.sort_order
  FROM (VALUES (1, 10), (2, 20), (3, 30)) AS v(id, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM experiences)
ON CONFLICT DO NOTHING;

INSERT INTO experience_i18n (experience_id, locale, title, blurb, origin)
SELECT v.experience_id, 'en', v.title, v.blurb, 'seed'
  FROM (VALUES
    (1, 'Culinary Experiences',    'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights'),
    (2, 'Private Dining & Events', 'Weddings · Corporate · Celebrations · MICE dining'),
    (3, 'Furama Fabulous',         'Membership · Rewards · Dining privileges')
  ) AS v(experience_id, title, blurb)
  JOIN experiences e ON e.id = v.experience_id
ON CONFLICT DO NOTHING;

-- ── stories → story_i18n ──────────────────────────────────────────────────
-- Links out to an article (spec §2). The card's kicker is the category, then
-- the date when there is one ("Restaurant News · 9 Sep 2026"), formatted for
-- the language. story_i18n.href: the article in that language, if any.
CREATE TABLE IF NOT EXISTS stories (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  href         text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  published_on date,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS story_i18n (
  story_id    bigint      NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  category    text        CHECK (btrim(category) <> '' AND char_length(category) <= 60),
  title       text        CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  href        text        CHECK (href ~ '^https://' AND length(href) <= 2000),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (story_id, locale)
);

-- STORIES (lib/data.ts), its dates taken out of the kicker; the fourth has none.
INSERT INTO stories (id, image_id, href, published_on, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, v.href, v.published_on::date, v.sort_order
  FROM (VALUES
    (1, '/assets/story-dh-opening.jpg',  'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong', '2026-09-09', 10),
    (2, '/assets/story-the-fan.jpg',     'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau', '2026-09-05', 20),
    (3, '/assets/story-thai-siam.jpg',   'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan', '2026-09-03', 30),
    (4, '/assets/story-buffet-gala.jpg', 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/', NULL, 40)
  ) AS v(id, pathname, href, published_on, sort_order)
  JOIN media m ON m.pathname = v.pathname
 WHERE NOT EXISTS (SELECT 1 FROM stories)
ON CONFLICT DO NOTHING;

INSERT INTO story_i18n (story_id, locale, category, title, origin)
SELECT v.story_id, 'en', v.category, v.title, 'seed'
  FROM (VALUES
    (1, 'Restaurant News',      'Grand opening: one house, four flavours in An Thượng'),
    (2, 'Restaurant News',      'Steakhouse The Fan, where fine food meets art'),
    (3, 'Restaurant News',      'Thai Siam Kitchen, a bridge between Vietnam and Thailand'),
    (4, 'Furama Resort Danang', 'Inside the Central Vietnam Seafood & Steak Buffet Gala')
  ) AS v(story_id, category, title)
  JOIN stories s ON s.id = v.story_id
ON CONFLICT DO NOTHING;

-- ── offers → offer_i18n ───────────────────────────────────────────────────
-- bigint, to match reservations.offer_id (006). The card's detail line is
-- built from the price ("VND 888,000++ per guest") and the schedule, joined by
-- " · ". valid_from/valid_until are Da Nang calendar days; the reader caches
-- for hours and the daily cron expires content:offers (spec §6.2). The venue is
-- the restaurant's name unless venue_override says otherwise.
CREATE TABLE IF NOT EXISTS offers (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: offers have their own editor (phase 7), whose deletions land in
  -- audit_log one by one; deleting a restaurant must not take them silently.
  -- Restaurants are archived, not deleted, in the normal course.
  restaurant_id text          NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price_amount  numeric(14,2) CHECK (price_amount >= 0),
  currency      text          NOT NULL DEFAULT 'VND' CHECK (currency ~ '^[A-Z]{3}$'),
  price_basis   text          CHECK (price_basis IN ('plus_plus', 'net')),
  valid_from    date,
  valid_until   date,
  sort_order    integer       NOT NULL DEFAULT 0,
  is_published  boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    text,
  CONSTRAINT offers_price_pair CHECK ((price_amount IS NULL) = (price_basis IS NULL)),
  CONSTRAINT offers_valid_range CHECK (valid_from <= valid_until)
);

CREATE INDEX IF NOT EXISTS offers_restaurant_idx ON offers (restaurant_id);

CREATE TABLE IF NOT EXISTS offer_i18n (
  offer_id       bigint      NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title          text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  schedule       text        CHECK (btrim(schedule) <> '' AND char_length(schedule) <= 120),
  venue_override text        CHECK (btrim(venue_override) <> '' AND char_length(venue_override) <= 80),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (offer_id, locale)
);

-- OFFERS (lib/data.ts), the price taken out of the detail text. No validity
-- dates: none of the offers hides today (the section lede's "valid until 31
-- December 2026" is copy); the owner sets them in phase 7.
INSERT INTO offers (id, restaurant_id, price_amount, currency, price_basis, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, v.restaurant_id, v.price_amount, 'VND', v.price_basis, v.sort_order
  FROM (VALUES
    (1, 'cafe-indochine', 888000, 'plus_plus', 10),
    (2, 'taya-house',     799000, 'plus_plus', 20),
    (3, 'hai-van-lounge', 450000, 'net',       30)
  ) AS v(id, restaurant_id, price_amount, price_basis, sort_order)
  JOIN restaurants r ON r.id = v.restaurant_id
 WHERE NOT EXISTS (SELECT 1 FROM offers)
ON CONFLICT DO NOTHING;

INSERT INTO offer_i18n (offer_id, locale, title, schedule, origin)
SELECT v.offer_id, 'en', v.title, v.schedule, 'seed'
  FROM (VALUES
    (1, 'Seafood & Steak Buffet Dinner',  'Nightly 18:30–22:00'),
    (2, 'Vietnamese Cooking Class',       'Daily 11:00 or 14:00'),
    (3, 'Afternoon Tea & Dessert Buffet', '~30 pastries, 12+ teas')
  ) AS v(offer_id, title, schedule)
  JOIN offers o ON o.id = v.offer_id
ON CONFLICT DO NOTHING;

-- The booking keeps its date, time and party when an offer is deleted; it
-- loses only the link (spec §7.5 restores the offer under the same id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey') THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_offer_id_fkey
      FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL;
  END IF;
END $$;

-- For the FK's ON DELETE and the admin's "bookings from this offer".
CREATE INDEX IF NOT EXISTS reservations_offer_idx ON reservations (offer_id) WHERE offer_id IS NOT NULL;

-- ── nav_items → nav_item_i18n ─────────────────────────────────────────────
-- One label per language, in natural case: the header uppercases it with CSS,
-- the menu overlay shows it as it is (spec §6.3 item 6). An item hides itself
-- when its section is hidden (spec §6.5). An item scrolls to the element whose
-- id is its target_section, and these four have no anchor of their own name:
-- film and finder none at all, the hero #top, the booking bar #reserve. The
-- header's logo already reaches the top, and RESERVE already opens the booking
-- drawer. test/guards/nav-anchors.guard.test.ts checks every other section.
CREATE TABLE IF NOT EXISTS nav_items (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_section text        NOT NULL REFERENCES sections (key) ON UPDATE CASCADE
                             CHECK (target_section NOT IN ('film', 'finder', 'hero', 'booking_bar')),
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT nav_items_target_section_key UNIQUE (target_section)
);

CREATE TABLE IF NOT EXISTS nav_item_i18n (
  nav_item_id bigint      NOT NULL REFERENCES nav_items (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 18: the one-line desktop header (spec §6.5); the admin warns past 14.
  label       text        NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 18),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (nav_item_id, locale)
);

-- NAV_LINKS (lib/data.ts) with the menu overlay's case (MENU_LABELS).
INSERT INTO nav_items (id, target_section, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.target_section, v.sort_order
  FROM (VALUES (1, 'restaurants', 10), (2, 'destinations', 20), (3, 'experiences', 30),
               (4, 'offers', 40), (5, 'stories', 50), (6, 'heritage', 60))
       AS v(id, target_section, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM nav_items)
ON CONFLICT DO NOTHING;

INSERT INTO nav_item_i18n (nav_item_id, locale, label, origin)
SELECT v.nav_item_id, 'en', v.label, 'seed'
  FROM (VALUES (1, 'Restaurants'), (2, 'Destinations'), (3, 'Experiences'), (4, 'Offers'), (5, 'Stories'), (6, 'About'))
       AS v(nav_item_id, label)
  JOIN nav_items n ON n.id = v.nav_item_id
ON CONFLICT DO NOTHING;

-- ── social_links ──────────────────────────────────────────────────────────
-- The label is the platform's own name, written by the code (brand, not
-- translated). visible_locales NULL: every language (e.g. WeChat only for zh).
CREATE TABLE IF NOT EXISTS social_links (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        text        NOT NULL
                  CHECK (platform IN ('facebook', 'instagram', 'youtube', 'tiktok', 'zalo', 'x', 'tripadvisor', 'wechat', 'kakao', 'line')),
  href            text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  visible_locales text[]      CHECK (cardinality(visible_locales) >= 1 AND array_position(visible_locales, NULL) IS NULL),
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- SOCIALS (lib/data.ts). The owner confirmed the TikTok handle on 2026-10-03
-- (spec §15 item 14).
INSERT INTO social_links (id, platform, href, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.platform, v.href, v.sort_order
  FROM (VALUES
    (1, 'facebook',  'https://www.facebook.com/furamaresort',            10),
    (2, 'instagram', 'https://www.instagram.com/furamaculinaryworld/',   20),
    (3, 'youtube',   'https://www.youtube.com/user/furamaresortvietnam', 30),
    (4, 'tiktok',    'https://www.tiktok.com/@furama.dining.hous',       40)
  ) AS v(id, platform, href, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM social_links)
ON CONFLICT DO NOTHING;

-- ── site_settings (007): the remaining columns ────────────────────────────
-- default_restaurant_id: the booking bar's first choice (NULL: the first
-- bookable restaurant). default_occasion: the finder's (NULL: any). The two
-- seeds ride on a DEFAULT that is dropped right after, as 006 did for
-- reservations.source: the existing row gets them, later rows do not, and a
-- re-run (the columns exist) changes nothing.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS default_restaurant_id text    DEFAULT 'taya-house'
                                                         REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_occasion      text    DEFAULT 'Dinner'
                                                         CHECK (default_occasion IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks')),
  ADD COLUMN IF NOT EXISTS og_image_id           uuid    REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hero_autoplay_ms      integer NOT NULL DEFAULT 7000 CHECK (hero_autoplay_ms BETWEEN 3000 AND 20000);

ALTER TABLE site_settings
  ALTER COLUMN default_restaurant_id DROP DEFAULT,
  ALTER COLUMN default_occasion DROP DEFAULT;

-- ── identity sequences past the seeded ids ────────────────────────────────
-- Never moved back: a re-run after editors added rows keeps the sequence where it is.
SELECT setval('restaurant_highlights_id_seq', GREATEST((SELECT max(id) FROM restaurant_highlights), (SELECT last_value FROM restaurant_highlights_id_seq)));
SELECT setval('hero_slides_id_seq',           GREATEST((SELECT max(id) FROM hero_slides),           (SELECT last_value FROM hero_slides_id_seq)));
SELECT setval('experiences_id_seq',           GREATEST((SELECT max(id) FROM experiences),           (SELECT last_value FROM experiences_id_seq)));
SELECT setval('stories_id_seq',               GREATEST((SELECT max(id) FROM stories),               (SELECT last_value FROM stories_id_seq)));
SELECT setval('offers_id_seq',                GREATEST((SELECT max(id) FROM offers),                (SELECT last_value FROM offers_id_seq)));
SELECT setval('nav_items_id_seq',             GREATEST((SELECT max(id) FROM nav_items),             (SELECT last_value FROM nav_items_id_seq)));
SELECT setval('social_links_id_seq',          GREATEST((SELECT max(id) FROM social_links),          (SELECT last_value FROM social_links_id_seq)));
