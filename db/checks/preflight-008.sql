-- Read-only checks before applying 008_content.sql to a database at 007 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 008.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql

SELECT 'migrations 001-007 applied, 008 not' AS check,
       (SELECT count(*) FROM _migrations WHERE name < '008') = 7
       AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name >= '008') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
SELECT 'no table 008 creates exists yet',
       NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name IN ('media', 'media_i18n', 'destination_i18n', 'cuisines', 'cuisine_i18n', 'restaurant_i18n',
                                         'restaurant_cuisines', 'restaurant_highlights', 'restaurant_highlight_i18n', 'sections',
                                         'hero_slides', 'experiences', 'experience_i18n', 'stories', 'story_i18n', 'offers',
                                         'offer_i18n', 'nav_items', 'nav_item_i18n', 'social_links')),
       NULL
UNION ALL
-- The guard in 008 stops on this.
SELECT 'no booking carries an offer_id',
       NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL),
       (SELECT count(*)::text FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
-- The guard in 008 stops on this too.
SELECT 'every restaurants.cuisines label is one of the 8 cuisines',
       NOT EXISTS (SELECT 1 FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
                    WHERE c.label NOT IN ('Vietnamese', 'Italian', 'Thai', 'Japanese', 'Steak & Grill', 'Hotpot', 'International', 'Café & Lounge')),
       (SELECT string_agg(DISTINCT c.label, ', ') FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label))
UNION ALL
-- Each needs public/assets/r-<id>.jpg (restaurants_published_card would stop 008 otherwise).
SELECT 'the 12 restaurants of 002, each with a card picture in public/assets',
       (SELECT array_agg(id ORDER BY id) FROM restaurants) = ARRAY['cafe-indochine', 'chaoshan-hotpot', 'danaksara', 'don-ciprianis',
         'hai-van-lounge', 'hura-izakaya', 'pho-cuon', 'taya-house', 'thai-siam-kitchen', 'the-fan', 'v-senses-cafe', 'yum-food-village'],
       (SELECT string_agg(id, ', ' ORDER BY id) FROM restaurants)
UNION ALL
SELECT 'every restaurant has a type and a known destination',
       NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.type IS NULL OR btrim(r.type) = ''
                      OR NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = r.destination)),
       NULL
UNION ALL
SELECT 'the four destinations of 004, without a card picture yet',
       (SELECT array_agg(id ORDER BY id) FROM destinations) = ARRAY['dining-house', 'future', 'mm', 'resort']
       AND NOT EXISTS (SELECT 1 FROM destinations WHERE card_image_id IS NOT NULL),
       (SELECT string_agg(id || ':' || coalesce(card_image_id::text, '-'), ', ' ORDER BY id) FROM destinations)
UNION ALL
SELECT 'site_settings has its one row (007)',
       (SELECT count(*) FROM site_settings) = 1,
       (SELECT email FROM site_settings)
UNION ALL
SELECT 'the en locale exists (every seeded translation is en)',
       EXISTS (SELECT 1 FROM locales WHERE code = 'en' AND is_default),
       NULL
UNION ALL
SELECT 'gen_random_uuid() is available (media.id)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid'),
       NULL;
