import { afterAll, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { COLUMN_SCREENS } from '../../lib/admin/content-screens';
import { CONTENT_TABLES } from '../../lib/cache-plan';

/*
 * COLUMN_SCREENS (lib/admin/content-screens.ts) against the migrated schema:
 * every column of every content table is listed (an editing screen, or why
 * none), and the map lists no column that does not exist. A migration that
 * adds a guest-visible column fails here until its screen is named.
 */
const url = process.env.TEST_DATABASE_URL;

/**
 * The content columns that are NOT NULL without a DEFAULT as of migration 009.
 * Phase-7 code rule 4: a restore writes an old snapshot back with
 * jsonb_populate_record, so a column added later without a DEFAULT, and not
 * nullable, would make every older version of a deleted row unrestorable
 * (kit spike risk 3). A later migration adds a column with a DEFAULT or
 * nullable; this list never grows.
 */
const REQUIRED_AT_009 = [
  'content_strings.key', 'content_strings.locale', 'content_strings.value', 'cuisine_i18n.cuisine_id', 'cuisine_i18n.locale',
  'cuisines.id', 'cuisines.image_id', 'destination_i18n.destination_id', 'destination_i18n.locale', 'destinations.id', 'destinations.kind',
  'experience_i18n.experience_id', 'experience_i18n.locale', 'experiences.id', 'hero_slides.id', 'hero_slides.image_id',
  'legal_versions.effective_on', 'legal_versions.text_sha256', 'legal_versions.version', 'locales.bcp47', 'locales.code',
  'locales.native_name', 'locales.script', 'locales.short_label', 'media.bytes', 'media.content_type', 'media.pathname', 'media.storage',
  'media.url', 'media_i18n.alt', 'media_i18n.locale', 'media_i18n.media_id', 'nav_item_i18n.label', 'nav_item_i18n.locale',
  'nav_item_i18n.nav_item_id', 'nav_items.id', 'nav_items.target_section', 'offer_i18n.locale', 'offer_i18n.offer_id', 'offers.id',
  'offers.restaurant_id', 'restaurant_cuisines.cuisine_id', 'restaurant_cuisines.restaurant_id', 'restaurant_highlight_i18n.highlight_id',
  'restaurant_highlight_i18n.locale', 'restaurant_highlights.id', 'restaurant_highlights.image_id', 'restaurant_highlights.restaurant_id',
  'restaurant_i18n.locale', 'restaurant_i18n.restaurant_id', 'restaurants.destination_id', 'restaurants.id', 'restaurants.name',
  'restaurants.slug', 'sections.key', 'service_periods.covers_per_slot', 'service_periods.first_seating', 'service_periods.id',
  'service_periods.last_seating', 'service_periods.meal', 'service_periods.restaurant_id', 'site_settings.email', 'social_links.href',
  'social_links.id', 'social_links.platform', 'stories.href', 'stories.id', 'stories.image_id', 'story_i18n.locale', 'story_i18n.story_id',
];


describe.skipIf(!url)('every content column has an owner (spec §7.2 CI test)', () => {
  afterAll(() => getPool().end());

  it('COLUMN_SCREENS equals information_schema for the content tables', async () => {
    {
      const rows = await query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [CONTENT_TABLES],
      );
      const actual = rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
      const mapped = Object.entries(COLUMN_SCREENS)
        .flatMap(([t, cols]) => Object.keys(cols).map((c) => `${t}.${c}`))
        .sort();
      expect({ unmapped: actual.filter((c) => !mapped.includes(c)), missing: mapped.filter((c) => !actual.includes(c)) }).toEqual({
        unmapped: [],
        missing: [],
      });
    }
  });

  it('every content column added after 009 has a DEFAULT or takes NULL (code rule 4: old snapshots stay restorable)', async () => {
    const rows = await query<{ col: string }>(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND is_nullable = 'NO' AND column_default IS NULL
        ORDER BY 1`,
      [CONTENT_TABLES],
    );
    expect(rows.map((r) => r.col).filter((c) => !REQUIRED_AT_009.includes(c))).toEqual([]);
  });
});
