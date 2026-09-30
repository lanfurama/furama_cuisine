-- The restaurant catalogue. This table is the source of truth: the app reads it
-- rather than keeping a parallel copy in application code. Re-running updates
-- rows in place so edits here roll forward safely.

INSERT INTO restaurants (id, name, type, destination, cuisines, meals, slot_capacity, sort_order) VALUES
  ('cafe-indochine',    'Café Indochine',     'Asian & International',       'resort',       ARRAY['International'],                        ARRAY['Breakfast','Lunch','Dinner'], 40,  1),
  ('don-ciprianis',     'Don Cipriani’s',     'Italian Trattoria',           'resort',       ARRAY['Italian'],                              ARRAY['Lunch','Dinner'],             24,  2),
  ('taya-house',        'Tàya House',         'Vietnamese · Cooking Class',  'resort',       ARRAY['Vietnamese'],                           ARRAY['Lunch','Dinner'],             16,  3),
  ('danaksara',         'Danaksara',          'Central Vietnamese',          'resort',       ARRAY['Vietnamese'],                           ARRAY['Breakfast','Dinner'],         20,  4),
  ('the-fan',           'Steakhouse The Fan', 'Steak & Wine · 3F',           'dining-house', ARRAY['Steak & Grill'],                        ARRAY['Lunch','Dinner'],             18,  5),
  ('pho-cuon',          'Phố Cuốn',           'Vietnamese · 1F',             'dining-house', ARRAY['Vietnamese'],                           ARRAY['Breakfast','Lunch','Dinner'], 30,  6),
  ('thai-siam-kitchen', 'Thai Siam Kitchen',  'Thai · 2F',                   'dining-house', ARRAY['Thai'],                                 ARRAY['Lunch','Dinner'],             22,  7),
  ('hura-izakaya',      'Hura Izakaya',       'Japanese Izakaya · 4F',       'dining-house', ARRAY['Japanese'],                             ARRAY['Dinner'],                     20,  8),
  ('yum-food-village',  'Yum Food Village',   'Asian Food Hall',             'mm',           ARRAY['International','Vietnamese','Thai'],    ARRAY['Lunch','Dinner'],             60,  9),
  ('chaoshan-hotpot',   'ChaoShan Hotpot',    'Chinese Hotpot',              'mm',           ARRAY['Hotpot'],                               ARRAY['Lunch','Dinner'],             28, 10),
  ('v-senses-cafe',     'V-Senses Cafe',      'Northern Vietnamese',         'resort',       ARRAY['Vietnamese','Café & Lounge'],           ARRAY['Breakfast','Lunch','Dinner'], 26, 11),
  ('hai-van-lounge',    'Hải Vân Lounge',     'Lounge · Live Jazz',          'resort',       ARRAY['Café & Lounge'],                        ARRAY['Drinks'],                     24, 12)
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  type          = EXCLUDED.type,
  destination   = EXCLUDED.destination,
  cuisines      = EXCLUDED.cuisines,
  meals         = EXCLUDED.meals,
  slot_capacity = EXCLUDED.slot_capacity,
  sort_order    = EXCLUDED.sort_order;
