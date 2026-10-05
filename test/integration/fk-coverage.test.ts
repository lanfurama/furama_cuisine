import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * L7-17 (phase-6 ledger): every foreign key a delete or a restore of phase 7
 * relies on is exercised by a named test. The matrix below is every foreign
 * key of the schema with its ON DELETE action as the database has it: a new
 * key, or a changed action, fails the first test until it is placed here,
 * with the test that drives its action through an editor's delete or
 * restore, or with the reason no phase-7 path deletes its parent. The second
 * test checks each named test still exists, word for word, in its file.
 *
 * ON DELETE: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL.
 */

type Covered = { action: 'a' | 'r' | 'c' | 'n'; test: [file: string, title: string] } | { action: 'a' | 'r' | 'c' | 'n'; none: string };

const MEDIA_TEST: [string, string] = [
  'test/integration/media-library.test.ts',
  'names every column that references media, as the database has them (a new one must be added to MEDIA_REFERENCES)',
];
const DESTINATION_IN_USE: [string, string] = [
  'test/integration/content-destinations.test.ts',
  'a destination with restaurants, closures or recipients cannot be deleted (they would go with it); nothing is written',
];
const OFFER_ACCEPTANCE: [string, string] = [
  'test/integration/content-editors.test.ts',
  'ACCEPTANCE: edit an offer, restore the version before; delete it, restore it; the guest list follows each step',
];
const NEVER_DELETED = 'restaurants are never deleted, only archived (F10, R22): no path deletes the parent';
const LOCALES = 'phase 8: languages are managed on /admin/locales; no phase-7 path deletes one (migration-008.test.ts pins the action)';
const BOOKINGS = 'bookings are never deleted before phase 10’s retention (spec §11): no phase-7 path deletes the parent';

const FK_MATRIX: Record<string, Covered> = {
  // Files (spec §5.2): RESTRICT on every column that shows one; the library refuses a delete while one does (AC3).
  restaurants_card_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  restaurants_detail_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  restaurants_og_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  destinations_card_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  site_settings_og_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  cuisines_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  restaurant_i18n_menu_pdf_media_id_fkey: { action: 'r', test: MEDIA_TEST },
  restaurant_highlights_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  sections_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  hero_slides_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  hero_slides_image_mobile_id_fkey: { action: 'r', test: MEDIA_TEST },
  stories_image_id_fkey: { action: 'r', test: MEDIA_TEST },
  media_i18n_media_id_fkey: {
    action: 'c',
    test: [
      'test/integration/media-library.test.ts',
      'a version whose picture is in the trash brings the picture back; one whose picture was purged cannot come back; a save cannot point at a trashed file',
    ],
  },
  // Destinations (R26): refused while anything points at one, CASCADE included.
  restaurants_destination_fk: { action: 'a', test: DESTINATION_IN_USE },
  restaurants_destination_id_fkey: { action: 'a', test: DESTINATION_IN_USE },
  closures_destination_id_fkey: { action: 'c', test: DESTINATION_IN_USE },
  notification_recipients_destination_id_fkey: { action: 'c', test: DESTINATION_IN_USE },
  destination_i18n_destination_id_fkey: {
    action: 'c',
    test: ['test/integration/content-destinations.test.ts', 'a new destination takes its slug once; deleted, it comes back under that id in its place; the order and its History'],
  },
  // Cuisines: RESTRICT from restaurants (23001 refused cleanly); their labels go and come back with them.
  restaurant_cuisines_cuisine_id_fkey: {
    action: 'r',
    test: ['test/integration/content-cuisines.test.ts', 'the database stays the last guard: a delete a RESTRICT key refuses (23001) is refused cleanly, nothing written'],
  },
  cuisine_i18n_cuisine_id_fkey: {
    action: 'c',
    test: [
      'test/integration/content-cuisines.test.ts',
      'a cuisine a restaurant lists cannot be deleted, and the refusal names it; an unused one comes back under its slug, in its place',
    ],
  },
  // The lists' translations: deleted with their item, written back by its restore under its id.
  experience_i18n_experience_id_fkey: {
    action: 'c',
    test: [
      'test/integration/content-experiences-stories.test.ts',
      'needs its EN title (save and restore); at most 5 shown; deleted, it comes back under its id in its place; the order and its History',
    ],
  },
  story_i18n_story_id_fkey: {
    action: 'c',
    test: ['test/integration/content-experiences-stories.test.ts', 'at most 4 shown; a hidden draft is allowed; the picture must be live; deleted, a card comes back under its id'],
  },
  offer_i18n_offer_id_fkey: { action: 'c', test: OFFER_ACCEPTANCE },
  // R9: a deleted offer leaves its bookings without one (and a reservation_event each).
  reservations_offer_id_fkey: { action: 'n', test: OFFER_ACCEPTANCE },
  nav_item_i18n_nav_item_id_fkey: {
    action: 'c',
    test: [
      'test/integration/content-navigation.test.ts',
      'deleted, an item comes back under its id in its place, unless its section has another item by then; the order and its History',
    ],
  },
  nav_items_target_section_fkey: { action: 'a', none: 'sections are a fixed set (migration 008’s CHECK): no path deletes one' },
  // The restaurant aggregate: its highlights go and come back under their ids; the restaurant itself never goes.
  restaurant_highlight_i18n_highlight_id_fkey: {
    action: 'c',
    test: ['test/integration/content-restaurant.test.ts', 'highlights: remove one, add one, reorder and hide; the page follows; a restore brings the removed one back under its id'],
  },
  restaurant_highlights_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  restaurant_i18n_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  restaurant_cuisines_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  service_periods_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  closures_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  notification_recipients_restaurant_id_fkey: { action: 'c', none: NEVER_DELETED },
  reservations_restaurant_id_fkey: { action: 'a', none: NEVER_DELETED },
  offers_restaurant_id_fkey: { action: 'r', none: NEVER_DELETED },
  site_settings_default_restaurant_id_fkey: {
    action: 'n',
    test: ['test/integration/content-settings.test.ts', '“none” is a choice for both; an archived or unknown restaurant and a meal the CHECK refuses are not, on a save or a restore'],
  },
  // A closure's reasons go with it (phase 4).
  closure_i18n_closure_id_fkey: {
    action: 'c',
    test: ['test/integration/booking-config.test.ts', 'creates, reads back with its reasons, updates and deletes, each with an audit row'],
  },
  // Staff (phase 3): a removal ends their sessions.
  staff_session_user_id_fkey: { action: 'c', test: ['test/integration/staff-auth.test.ts', 'removing staff deletes their sessions and logs the removal'] },
  staff_account_user_id_fkey: { action: 'c', test: ['test/integration/staff-auth.test.ts', 'removing staff deletes their sessions and logs the removal'] },
  // Bookings and their trail.
  reservation_events_reservation_id_fkey: { action: 'c', none: BOOKINGS },
  reservation_notes_reservation_id_fkey: { action: 'c', none: BOOKINGS },
  email_outbox_reservation_id_fkey: { action: 'c', none: BOOKINGS },
  email_outbox_reservation_event_id_fkey: { action: 'n', none: BOOKINGS },
  // Languages (phase 8).
  content_strings_locale_fkey: { action: 'c', none: LOCALES },
  closure_i18n_locale_fkey: { action: 'c', none: LOCALES },
  reservations_locale_fkey: { action: 'a', none: LOCALES },
  notification_recipients_locale_fkey: { action: 'a', none: LOCALES },
  email_outbox_locale_fkey: { action: 'a', none: LOCALES },
  media_i18n_locale_fkey: { action: 'c', none: LOCALES },
  destination_i18n_locale_fkey: { action: 'c', none: LOCALES },
  cuisine_i18n_locale_fkey: { action: 'c', none: LOCALES },
  restaurant_i18n_locale_fkey: { action: 'c', none: LOCALES },
  restaurant_highlight_i18n_locale_fkey: { action: 'c', none: LOCALES },
  experience_i18n_locale_fkey: { action: 'c', none: LOCALES },
  story_i18n_locale_fkey: { action: 'c', none: LOCALES },
  offer_i18n_locale_fkey: { action: 'c', none: LOCALES },
  nav_item_i18n_locale_fkey: { action: 'c', none: LOCALES },
};

const ROOT = join(__dirname, '..', '..');

describe.skipIf(!TEST_DATABASE_URL)('every foreign key a delete or restore relies on is tested (L7-17)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(() => pool.end());

  it('the matrix is every foreign key of the schema, with its ON DELETE action', async () => {
    const { rows } = await pool.query<{ name: string; action: string }>(
      `SELECT c.conname AS name, c.confdeltype AS action FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'f' AND n.nspname = 'public' ORDER BY 1`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.name, r.action]))).toEqual(
      Object.fromEntries(Object.entries(FK_MATRIX).map(([name, c]) => [name, c.action]).sort(([a], [b]) => (a < b ? -1 : 1))),
    );
  });

  it.each(Object.entries(FK_MATRIX).filter(([, c]) => 'test' in c) as [string, { test: [string, string] }][])(
    '%s: its test still exists, word for word',
    (_, covered) => {
      const [file, title] = covered.test;
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain(`it('${title}'`);
    },
  );
});
