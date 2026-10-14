-- Furama's own photographs (2026-10). Expand only, one transaction, safe to re-run.
--
-- Registers 37 new files of public/assets as static media rows, measured from
-- the files (type, pixel size, bytes), with English alt text where the file is
-- not decorative. Every one is a photograph Furama published on
-- furamavietnam.com or furamadining.com; db/content-packs/2026-10-official-photos.json
-- names each file's source page. They replace the design canvas's renditions,
-- many of them tiny (45 to 194 px) or not of Furama at all.
--
-- Nothing points at them here: the seeded content is the CMS's, so the content
-- pack (scripts/apply-content-pack.mjs) repoints only the pictures staff have
-- not changed since the seed, with an audit row each. Decorative follows 008's
-- rule (cuisine chips, destination and story cards, the heritage background,
-- hero slides 2 and 3); a restaurant card's alt is the restaurant's name.
-- Two cards wait in the library for restaurants staff have still to add
-- (Steak House The Fan at the resort, Steakhouse The Fan at MM Supercenter).

INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, is_decorative)
SELECT 'static', v.pathname, v.pathname, v.content_type, v.width, v.height, v.bytes, v.is_decorative
  FROM (VALUES
    ('/assets/chef-cafe-indochine-teppanyaki.jpg', 'image/jpeg', 1200, 1715, 221320, false),
    ('/assets/cuisine-cafe-lounge-tea.jpg', 'image/jpeg', 480, 480, 65447, true),
    ('/assets/cuisine-hotpot-chao-shan.jpg', 'image/jpeg', 480, 480, 56570, true),
    ('/assets/cuisine-international-buffet.jpg', 'image/jpeg', 480, 480, 55029, true),
    ('/assets/cuisine-italian-pizza.jpg', 'image/jpeg', 480, 480, 36493, true),
    ('/assets/cuisine-japanese-dish.jpg', 'image/jpeg', 480, 480, 33874, true),
    ('/assets/cuisine-steak-grill-dinner.jpg', 'image/jpeg', 480, 480, 39410, true),
    ('/assets/cuisine-thai-dish.jpg', 'image/jpeg', 480, 480, 44809, true),
    ('/assets/cuisine-vietnamese-bun.jpg', 'image/jpeg', 480, 480, 29257, true),
    ('/assets/dest-dining-house-facade.jpg', 'image/jpeg', 700, 1091, 155565, true),
    ('/assets/dest-mm-food-court.jpg', 'image/jpeg', 700, 1091, 106676, true),
    ('/assets/dest-resort-lobby-blue-hour.jpg', 'image/jpeg', 668, 1041, 118851, true),
    ('/assets/film-resort-beach.jpg', 'image/jpeg', 1600, 989, 293860, false),
    ('/assets/heritage-resort-lobby-dusk.jpg', 'image/jpeg', 1920, 1080, 244885, true),
    ('/assets/hero-cafe-indochine-show-kitchen.jpg', 'image/jpeg', 2400, 1600, 319872, true),
    ('/assets/hero-resort-courtyard-sunset-m.jpg', 'image/jpeg', 791, 1055, 119715, false),
    ('/assets/hero-resort-courtyard-sunset.jpg', 'image/jpeg', 2000, 1055, 316714, false),
    ('/assets/hero-taya-house-dusk.jpg', 'image/jpeg', 2000, 1334, 612455, true),
    ('/assets/r-cafe-indochine-seafood-buffet.jpg', 'image/jpeg', 1280, 960, 228611, false),
    ('/assets/r-chaoshan-beef-hotpot-mm.jpg', 'image/jpeg', 1280, 960, 223200, false),
    ('/assets/r-danaksara-dining-room.jpg', 'image/jpeg', 1280, 960, 261499, false),
    ('/assets/r-hai-van-lounge-bar.jpg', 'image/jpeg', 1280, 960, 140502, false),
    ('/assets/r-hura-izakaya-dining-house.jpg', 'image/jpeg', 1280, 960, 164296, false),
    ('/assets/r-pho-cuon-dining-house.jpg', 'image/jpeg', 1280, 960, 197771, false),
    ('/assets/r-steak-house-the-fan-resort.jpg', 'image/jpeg', 1280, 960, 136960, false),
    ('/assets/r-taya-house-dusk.jpg', 'image/jpeg', 1280, 960, 309462, false),
    ('/assets/r-thai-siam-kitchen-dining-house.jpg', 'image/jpeg', 1280, 960, 247659, false),
    ('/assets/r-the-fan-dining-house.jpg', 'image/jpeg', 1280, 960, 168510, false),
    ('/assets/r-the-fan-mm.jpg', 'image/jpeg', 1280, 960, 181249, false),
    ('/assets/r-v-senses-cafe-heritage-house.jpg', 'image/jpeg', 1280, 960, 239410, false),
    ('/assets/r-yum-food-village-mm.jpg', 'image/jpeg', 1280, 960, 164182, false),
    ('/assets/story-dining-house-grand-opening.jpg', 'image/jpeg', 1200, 882, 226578, true),
    ('/assets/story-seafood-steak-buffet-gala.jpg', 'image/jpeg', 871, 640, 79608, true),
    ('/assets/story-thai-siam-journey.jpg', 'image/jpeg', 1200, 882, 190594, true),
    ('/assets/story-the-fan-journey.jpg', 'image/jpeg', 1200, 882, 125804, true),
    ('/assets/taya-house-garden-day.jpg', 'image/jpeg', 1280, 960, 313622, false),
    ('/assets/taya-house-portrait.jpg', 'image/jpeg', 1100, 1375, 357183, false)
  ) AS v(pathname, content_type, width, height, bytes, is_decorative)
ON CONFLICT (pathname) DO NOTHING;

INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', v.alt, 'seed'
  FROM (VALUES
('/assets/chef-cafe-indochine-teppanyaki.jpg', 'Chefs at the Teppanyaki station of the Seafood & Steak Buffet, Café Indochine'),
    ('/assets/film-resort-beach.jpg', 'Thatched umbrellas and sun loungers on the beach at Furama Resort Danang'),
    ('/assets/hero-resort-courtyard-sunset-m.jpg', 'The courtyard of Furama Resort Danang at sunset, its terraces leading to the sea'),
    ('/assets/hero-resort-courtyard-sunset.jpg', 'The courtyard of Furama Resort Danang at sunset, its terraces leading to the sea'),
    ('/assets/r-cafe-indochine-seafood-buffet.jpg', 'Café Indochine'),
    ('/assets/r-chaoshan-beef-hotpot-mm.jpg', 'ChaoShan Hotpot'),
    ('/assets/r-danaksara-dining-room.jpg', 'Danaksara'),
    ('/assets/r-hai-van-lounge-bar.jpg', 'Hải Vân Lounge'),
    ('/assets/r-hura-izakaya-dining-house.jpg', 'Hura Izakaya'),
    ('/assets/r-pho-cuon-dining-house.jpg', 'Phố Cuốn'),
    ('/assets/r-steak-house-the-fan-resort.jpg', 'Steak House The Fan'),
    ('/assets/r-taya-house-dusk.jpg', 'Tàya House'),
    ('/assets/r-thai-siam-kitchen-dining-house.jpg', 'Thai Siam Kitchen'),
    ('/assets/r-the-fan-dining-house.jpg', 'Steakhouse The Fan'),
    ('/assets/r-the-fan-mm.jpg', 'Steakhouse The Fan'),
    ('/assets/r-v-senses-cafe-heritage-house.jpg', 'V-Senses Cafe'),
    ('/assets/r-yum-food-village-mm.jpg', 'Yum Food Village'),
    ('/assets/taya-house-garden-day.jpg', 'Tàya House, the Muong stilt house in the Lagoon Garden'),
    ('/assets/taya-house-portrait.jpg', 'Tàya House')
  ) AS v(pathname, alt)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;
