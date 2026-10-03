-- Read-only checks after applying 008_content.sql (Neon). Every row should say
-- ok = true. The same comparisons as test/integration/content-seed.test.ts,
-- restricted to what SQL alone can see (no files, no lib/data.ts).
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql

SELECT 'row counts' AS check,
       (SELECT count(*) FROM media) = 39 AND (SELECT count(*) FROM media_i18n) = 20
       AND (SELECT count(*) FROM media WHERE is_decorative) = 19
       AND (SELECT count(*) FROM destination_i18n) = 4 AND (SELECT count(*) FROM cuisines) = 8
       AND (SELECT count(*) FROM restaurant_i18n) = 12 AND (SELECT count(*) FROM restaurant_cuisines) = 15
       AND (SELECT count(*) FROM restaurant_highlights) = 4 AND (SELECT count(*) FROM sections) = 11
       AND (SELECT count(*) FROM hero_slides) = 3 AND (SELECT count(*) FROM experiences) = 3
       AND (SELECT count(*) FROM stories) = 4 AND (SELECT count(*) FROM offers) = 3
       AND (SELECT count(*) FROM nav_items) = 6 AND (SELECT count(*) FROM social_links) = 4 AS ok
UNION ALL
SELECT 'restaurants: slug = id, destination_id = destination, card picture r-<id>.jpg',
       NOT EXISTS (SELECT 1 FROM restaurants r LEFT JOIN media m ON m.id = r.card_image_id
                    WHERE r.slug IS DISTINCT FROM r.id OR r.destination_id IS DISTINCT FROM r.destination
                       OR m.pathname IS DISTINCT FROM '/assets/r-' || r.id || '.jpg')
UNION ALL
SELECT 'restaurants: type_label (en) = type, and the card alt = name',
       NOT EXISTS (SELECT 1 FROM restaurants r
                     LEFT JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
                     LEFT JOIN media_i18n mi ON mi.media_id = r.card_image_id AND mi.locale = 'en'
                    WHERE ri.type_label IS DISTINCT FROM r.type OR mi.alt IS DISTINCT FROM r.name)
UNION ALL
SELECT 'restaurants: restaurant_cuisines = cuisines, label for label, in order',
       NOT EXISTS (SELECT 1 FROM restaurants r
                    WHERE r.cuisines IS DISTINCT FROM ARRAY(SELECT ci.label FROM restaurant_cuisines rc
                                                              JOIN cuisine_i18n ci ON ci.cuisine_id = rc.cuisine_id AND ci.locale = 'en'
                                                             WHERE rc.restaurant_id = r.id ORDER BY rc.sort_order))
UNION ALL
SELECT 'only Tàya House has a page, with its portrait, story and 4 highlights',
       (SELECT array_agg(id) FROM restaurants WHERE has_detail_page) = ARRAY['taya-house']
       AND (SELECT m.pathname FROM restaurants r JOIN media m ON m.id = r.detail_image_id WHERE r.id = 'taya-house') = '/assets/taya-hero.jpg'
       AND (SELECT story IS NOT NULL AND seo_title = 'Tàya House — Furama Cuisine' FROM restaurant_i18n WHERE restaurant_id = 'taya-house' AND locale = 'en')
       AND (SELECT count(*) FROM restaurant_highlights WHERE restaurant_id = 'taya-house') = 4
UNION ALL
SELECT 'every destination has its card picture dest-<id>.jpg and an en row',
       NOT EXISTS (SELECT 1 FROM destinations d LEFT JOIN media m ON m.id = d.card_image_id
                    WHERE m.pathname IS DISTINCT FROM '/assets/dest-' || d.id || '.jpg'
                       OR NOT EXISTS (SELECT 1 FROM destination_i18n di WHERE di.destination_id = d.id AND di.locale = 'en'))
UNION ALL
SELECT 'reservations.offer_id has its FK, and no booking points at an offer',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey')
       AND NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
SELECT 'site_settings: email kept, Tàya House and Dinner preselected, 7 s slides',
       (SELECT email IS NOT NULL AND default_restaurant_id = 'taya-house' AND default_occasion = 'Dinner'
               AND og_image_id IS NULL AND hero_autoplay_ms = 7000 FROM site_settings)
UNION ALL
SELECT 'every seeded translation is en, reviewed, seed',
       NOT EXISTS (SELECT 1 FROM (SELECT locale, status, origin FROM media_i18n UNION ALL SELECT locale, status, origin FROM destination_i18n
                     UNION ALL SELECT locale, status, origin FROM cuisine_i18n UNION ALL SELECT locale, status, origin FROM restaurant_i18n
                     UNION ALL SELECT locale, status, origin FROM restaurant_highlight_i18n UNION ALL SELECT locale, status, origin FROM experience_i18n
                     UNION ALL SELECT locale, status, origin FROM story_i18n UNION ALL SELECT locale, status, origin FROM offer_i18n
                     UNION ALL SELECT locale, status, origin FROM nav_item_i18n) t
                    WHERE locale <> 'en' OR status <> 'reviewed' OR origin <> 'seed')
UNION ALL
SELECT 'identity sequences are past the seeded ids',
       (SELECT last_value FROM offers_id_seq) >= 3 AND (SELECT last_value FROM stories_id_seq) >= 4
       AND (SELECT last_value FROM nav_items_id_seq) >= 6 AND (SELECT last_value FROM restaurant_highlights_id_seq) >= 4;
