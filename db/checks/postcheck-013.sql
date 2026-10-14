-- Read-only checks after applying 013_official_photos.sql (Neon). Every row should say ok = true.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-013.sql

WITH added (pathname) AS (
  SELECT '/assets/' || f FROM unnest(ARRAY[
    'chef-cafe-indochine-teppanyaki.jpg', 'cuisine-cafe-lounge-tea.jpg', 'cuisine-hotpot-chao-shan.jpg',
    'cuisine-international-buffet.jpg', 'cuisine-italian-pizza.jpg', 'cuisine-japanese-dish.jpg',
    'cuisine-steak-grill-dinner.jpg', 'cuisine-thai-dish.jpg', 'cuisine-vietnamese-bun.jpg',
    'dest-dining-house-facade.jpg', 'dest-mm-food-court.jpg', 'dest-resort-lobby-blue-hour.jpg',
    'film-resort-beach.jpg', 'heritage-resort-lobby-dusk.jpg', 'hero-cafe-indochine-show-kitchen.jpg',
    'hero-resort-courtyard-sunset-m.jpg', 'hero-resort-courtyard-sunset.jpg', 'hero-taya-house-dusk.jpg',
    'r-cafe-indochine-seafood-buffet.jpg', 'r-chaoshan-beef-hotpot-mm.jpg', 'r-danaksara-dining-room.jpg',
    'r-hai-van-lounge-bar.jpg', 'r-hura-izakaya-dining-house.jpg', 'r-pho-cuon-dining-house.jpg', 'r-steak-house-the-fan-resort.jpg', 'r-the-fan-mm.jpg',
    'r-taya-house-dusk.jpg', 'r-thai-siam-kitchen-dining-house.jpg', 'r-the-fan-dining-house.jpg',
    'r-v-senses-cafe-heritage-house.jpg', 'r-yum-food-village-mm.jpg', 'story-dining-house-grand-opening.jpg',
    'story-seafood-steak-buffet-gala.jpg', 'story-the-fan-journey.jpg', 'story-thai-siam-journey.jpg',
    'taya-house-garden-day.jpg', 'taya-house-portrait.jpg'
  ]) AS f
)
SELECT 'migration 013 recorded' AS check,
       EXISTS (SELECT 1 FROM _migrations WHERE name = '013_official_photos.sql') AS ok,
       NULL AS detail
UNION ALL
SELECT 'the 37 photographs are live static rows',
       (SELECT count(*) FROM media m JOIN added a USING (pathname) WHERE m.storage = 'static' AND m.deleted_at IS NULL) = 37,
       (SELECT count(*)::text || ' of 37' FROM media m JOIN added a USING (pathname) WHERE m.storage = 'static' AND m.deleted_at IS NULL)
UNION ALL
SELECT 'every one that is not decorative has English alt text',
       NOT EXISTS (SELECT 1 FROM media m JOIN added a USING (pathname)
                    WHERE NOT m.is_decorative
                      AND NOT EXISTS (SELECT 1 FROM media_i18n mi WHERE mi.media_id = m.id AND mi.locale = 'en')),
       NULL;
