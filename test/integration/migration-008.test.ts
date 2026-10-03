import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 008 (phase 6): the content tables, the restaurants' content
 * columns, the rest of site_settings, and the FK of reservations.offer_id.
 * What it seeds is checked against the content of 8fe98f5 by content-seed.test.ts;
 * this file checks the upgrade from 007, the guards, a re-run, and the constraints.
 */

const url = databaseUrl('furama_cuisine_migrate008_test');
const FILE = 'db/migrations/008_content.sql';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
const count = async (table: string) => (await one(`SELECT count(*)::int AS n FROM ${table}`)).n as number;
const media = async (pathname: string) => (await one(`SELECT id FROM media WHERE pathname = $1`, [pathname])).id as string;
const tableExists = async (name: string) => (await one(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name])).ok as boolean;

/** A phase-5 web booking, as 007 leaves the tables. */
async function booking(restaurant = 'taya-house'): Promise<string> {
  const r = await one(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 111',
             '+849051' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'web')
     RETURNING id::text`,
    [restaurant],
  );
  return r.id;
}

const SEEDED: Record<string, number> = {
  media: 39, media_i18n: 20, destination_i18n: 4, cuisines: 8, cuisine_i18n: 8, restaurant_i18n: 12,
  restaurant_cuisines: 15, restaurant_highlights: 4, restaurant_highlight_i18n: 4, sections: 11, hero_slides: 3,
  experiences: 3, experience_i18n: 3, stories: 4, story_i18n: 4, offers: 3, offer_i18n: 3, nav_items: 6,
  nav_item_i18n: 6, social_links: 4,
};
const counts = async () => Object.fromEntries(await Promise.all(Object.keys(SEEDED).map(async (t) => [t, await count(t)])));

describe.skipIf(!TEST_DATABASE_URL)('migration 008: content tables (database)', () => {
  describe('on a database at 007 that already has bookings', () => {
    let existing: string;
    beforeAll(async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      existing = await booking();
      migrate(url);
    });

    it('seeds every table and leaves the bookings as they were, without an offer', async () => {
      expect(await counts()).toEqual(SEEDED);
      expect(await one(`SELECT count(*)::int AS n, count(offer_id)::int AS offers FROM reservations`)).toEqual({ n: 1, offers: 0 });
      expect(await one(`SELECT version FROM reservations WHERE id = $1`, [existing])).toEqual({ version: 1 });
    });

    it('passes the runbook post-check, whose sequence row fails for any seeded sequence left behind', async () => {
      // The file the controller runs on Neon after applying 008 (README, Deploying). One statement today;
      // pg answers a file of several with one result each, so both shapes are read.
      const postcheck = readFileSync('db/checks/postcheck-008.sql', 'utf8');
      const rows = async () => {
        const res = (await sql(postcheck)) as unknown;
        return (Array.isArray(res) ? res : [res]).flatMap((r) => (r as { rows: { check: string; ok: boolean }[] }).rows);
      };
      const failing = async () => (await rows()).filter((r) => r.ok !== true).map((r) => r.check);
      const SEQUENCES = 'identity sequences are past the seeded ids';

      expect((await rows()).map((r) => r.check)).toContain(SEQUENCES);
      expect(await failing()).toEqual([]);

      // A sequence behind its seeded ids: phase 7's first insert would collide with a seeded row.
      const tables = ['restaurant_highlights', 'hero_slides', 'experiences', 'stories', 'offers', 'nav_items', 'social_links'];
      const failed: Record<string, string[]> = {};
      for (const table of tables) {
        const seq = `${table}_id_seq`;
        const { last_value, is_called } = await one(`SELECT last_value::text, is_called FROM ${seq}`);
        try {
          await sql(`SELECT setval($1, 1)`, [seq]);
          failed[seq] = await failing();
        } finally {
          // setval is not transactional, so the value is put back by hand: later tests count on nextval.
          await sql(`SELECT setval($1, $2::bigint, $3)`, [seq, last_value, is_called]);
        }
      }
      // Only the sequence row turns false, once for each of the seven.
      expect(failed).toEqual(Object.fromEntries(tables.map((t) => [`${t}_id_seq`, [SEQUENCES]])));
      expect(await failing()).toEqual([]);
    });

    it('gives every restaurant a slug, a destination_id and a card picture, and only Tàya House a page', async () => {
      expect(
        await one(`SELECT count(*) FILTER (WHERE slug = id AND destination_id = destination AND card_image_id IS NOT NULL)::int AS ok,
                          array_agg(id) FILTER (WHERE has_detail_page) AS pages
                     FROM restaurants`),
      ).toEqual({ ok: 12, pages: ['taya-house'] });
      // The phase-1 columns stay, no longer required (phase 10 drops them).
      expect(
        (await sql(`SELECT column_name, is_nullable FROM information_schema.columns
                     WHERE table_name = 'restaurants' AND column_name IN ('type', 'destination', 'slug', 'destination_id')
                     ORDER BY column_name`)).rows,
      ).toEqual([
        { column_name: 'destination', is_nullable: 'YES' },
        { column_name: 'destination_id', is_nullable: 'NO' },
        { column_name: 'slug', is_nullable: 'NO' },
        { column_name: 'type', is_nullable: 'YES' },
      ]);
    });

    it('ties reservations.offer_id to offers: unknown ids refused, a deleted offer leaves the booking without one', async () => {
      await expect(sql(`UPDATE reservations SET offer_id = 99 WHERE id = $1`, [existing])).rejects.toThrow(/reservations_offer_id_fkey/);
      const { id: offer } = await one(`INSERT INTO offers (restaurant_id) VALUES ('taya-house') RETURNING id`);
      await sql(`UPDATE reservations SET offer_id = $1 WHERE id = $2`, [offer, existing]);
      await sql(`DELETE FROM offers WHERE id = $1`, [offer]);
      expect(await one(`SELECT offer_id FROM reservations WHERE id = $1`, [existing])).toEqual({ offer_id: null });
    });

    it('moves every identity sequence past the seeded ids', async () => {
      for (const table of ['restaurant_highlights', 'hero_slides', 'experiences', 'stories', 'nav_items', 'social_links']) {
        const max = (await one(`SELECT max(id)::int AS m FROM ${table}`)).m as number;
        const { n } = await one(`SELECT nextval('${table}_id_seq')::int AS n`);
        expect({ table, next: n }).toEqual({ table, next: max + 1 });
      }
    });

    it('is safe to apply again: no row added, no edit undone, no sequence moved back', async () => {
      // Editors' changes the seed must not touch on a re-run.
      await sql(`UPDATE offer_i18n SET title = 'Edited' WHERE offer_id = 1`);
      await sql(`UPDATE restaurants SET has_detail_page = false WHERE id = 'taya-house'`);
      await sql(`UPDATE restaurant_i18n SET story = 'Edited story' WHERE restaurant_id = 'taya-house' AND locale = 'en'`);
      await sql(`UPDATE site_settings SET default_restaurant_id = NULL, default_occasion = NULL`);
      await sql(`UPDATE media SET is_decorative = false WHERE pathname = '/assets/heritage.jpg'`);
      // A link an editor removed stays removed (its label is unchanged, so only the guard keeps it out).
      await sql(`DELETE FROM restaurant_cuisines WHERE restaurant_id = 'v-senses-cafe' AND cuisine_id = 'cafe-lounge'`);
      // A renamed label no longer matches restaurants.cuisines: the unknown-label guard must not fire on a re-run.
      await sql(`UPDATE cuisine_i18n SET label = 'Thai food' WHERE cuisine_id = 'thai' AND locale = 'en'`);
      // The newest story is deleted: its id must not be handed out again.
      const story = async () =>
        (await one(`INSERT INTO stories (image_id, href) VALUES ($1, 'https://example.com/a') RETURNING id::int`, [await media('/assets/chef.jpg')])).id as number;
      await story();
      const deleted = await story();
      await sql(`DELETE FROM stories WHERE id = $1`, [deleted]);
      const before = { ...(await counts()), offers: await count('offers') };

      await sql(readFileSync(FILE, 'utf8'));

      expect({ ...(await counts()), offers: await count('offers') }).toEqual(before);
      expect(await one(`SELECT title FROM offer_i18n WHERE offer_id = 1`)).toEqual({ title: 'Edited' });
      expect(await one(`SELECT has_detail_page FROM restaurants WHERE id = 'taya-house'`)).toEqual({ has_detail_page: false });
      expect(await one(`SELECT story FROM restaurant_i18n WHERE restaurant_id = 'taya-house'`)).toEqual({ story: 'Edited story' });
      expect(await one(`SELECT default_restaurant_id, default_occasion FROM site_settings`)).toEqual({
        default_restaurant_id: null,
        default_occasion: null,
      });
      expect(await one(`SELECT is_decorative FROM media WHERE pathname = '/assets/heritage.jpg'`)).toEqual({ is_decorative: false });
      expect((await sql(`SELECT cuisine_id FROM restaurant_cuisines WHERE restaurant_id = 'v-senses-cafe'`)).rows).toEqual([{ cuisine_id: 'vietnamese' }]);
      const { n } = await one(`SELECT nextval('stories_id_seq')::int AS n`);
      expect(n).toBe(deleted + 1);
    });

    it('does not bring back a seeded row an editor deleted: a list is seeded only while it is empty', async () => {
      // Fixed ids with ON CONFLICT DO NOTHING alone would insert offer 3 and its translation again.
      await sql(`DELETE FROM offers WHERE id = 3`);
      await sql(`DELETE FROM nav_items WHERE id = 6`);

      await sql(readFileSync(FILE, 'utf8'));

      expect((await sql(`SELECT id::int FROM offers WHERE id <= 3 ORDER BY id`)).rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(await one(`SELECT count(*)::int AS n FROM offer_i18n WHERE offer_id = 3`)).toEqual({ n: 0 });
      expect(await one(`SELECT count(*)::int AS n FROM nav_items WHERE target_section = 'heritage'`)).toEqual({ n: 0 });
    });
  });

  describe('guards', () => {
    it('stops, changing nothing, when a booking already carries an offer_id', async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      await sql(`UPDATE reservations SET offer_id = 2 WHERE id = $1`, [await booking()]);
      expect(() => migrate(url)).toThrow();
      expect(await tableExists('media')).toBe(false);
      expect(await one(`SELECT count(*)::int AS n FROM _migrations WHERE name = '008_content.sql'`)).toEqual({ n: 0 });
      await expect(sql(readFileSync(FILE, 'utf8'))).rejects.toThrow(/1 booking\(s\) already carry an offer_id/);
    });

    it('stops with the label when restaurants.cuisines holds one no cuisine has', async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      await sql(`UPDATE restaurants SET cuisines = ARRAY['Vietnamese', 'Fusion'] WHERE id = 'danaksara'`);
      await expect(sql(readFileSync(FILE, 'utf8'))).rejects.toThrow(/label\(s\) with no cuisine: Fusion/);
      expect(await tableExists('cuisines')).toBe(false);
    });
  });

  describe('constraints', () => {
    beforeAll(() => resetDatabase(url));

    it('media: a static file is served from /assets at its own path; images have a size, PDFs none; one row per path', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { storage: 'static', url: '/assets/x.jpg', pathname: '/assets/x.jpg', content_type: 'image/jpeg', width: 10, height: 10, bytes: 100, ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO media (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(r));
      };
      await expect(add({ url: '/x.jpg', pathname: '/x.jpg' })).rejects.toThrow(/media_static_path/);
      await expect(add({ url: '/assets/y.jpg' })).rejects.toThrow(/media_static_path/);
      await expect(add({ width: null })).rejects.toThrow(/media_dimensions/);
      await expect(add({ content_type: 'application/pdf', url: '/assets/m.pdf', pathname: '/assets/m.pdf' })).rejects.toThrow(/media_dimensions/);
      await add({ content_type: 'application/pdf', url: '/assets/m.pdf', pathname: '/assets/m.pdf', width: null, height: null });
      await expect(add({ content_type: 'image/gif' })).rejects.toThrow(/media_content_type_check/);
      await expect(add({ bytes: 15 * 1024 * 1024 + 1 })).rejects.toThrow(/media_bytes_check/);
      await expect(add({ storage: 'blob', url: 'http://x/y.jpg', pathname: 'media/y.jpg' })).rejects.toThrow(/media_blob_url/);
      await add({ storage: 'blob', url: 'https://store.public.blob.vercel-storage.com/media/y.jpg', pathname: 'media/y.jpg' });
      await expect(add({ url: '/assets/chef.jpg', pathname: '/assets/chef.jpg' })).rejects.toThrow(/media_pathname_key/);
      await expect(sql(`INSERT INTO media_i18n (media_id, locale, alt) VALUES ($1, 'en', '  ')`, [await media('/assets/m.pdf')])).rejects.toThrow(
        /media_i18n_alt_check/,
      );
    });

    it('a file in use cannot be deleted (ON DELETE RESTRICT); an unused one can', async () => {
      // Postgres 18 words it "violates RESTRICT setting of foreign key constraint <name>".
      const uses: [string, string][] = [
        ['/assets/chef.jpg', 'sections_image_id_fkey'],
        ['/assets/r-the-fan.jpg', 'restaurants_card_image_id_fkey'],
        ['/assets/taya-hero.jpg', 'restaurants_detail_image_id_fkey'],
        ['/assets/cuisine-thai.jpg', 'cuisines_image_id_fkey'],
        ['/assets/dest-mm.jpg', 'destinations_card_image_id_fkey'],
        ['/assets/taya-class.jpg', 'restaurant_highlights_image_id_fkey'],
        ['/assets/hero-taya.jpg', 'hero_slides_image_id_fkey'],
        ['/assets/hero-hall-m.jpg', 'hero_slides_image_mobile_id_fkey'],
        ['/assets/story-the-fan.jpg', 'stories_image_id_fkey'],
      ];
      for (const [path, constraint] of uses) {
        await expect(sql(`DELETE FROM media WHERE pathname = $1`, [path])).rejects.toThrow(
          new RegExp(`violates RESTRICT setting of foreign key constraint "${constraint}"`),
        );
      }
      await sql(`DELETE FROM media WHERE pathname = '/assets/m.pdf'`);
    });

    it('restaurants: a page needs its portrait, a shown card its picture, a phone both forms, a unique slug', async () => {
      await expect(sql(`UPDATE restaurants SET has_detail_page = true WHERE id = 'the-fan'`)).rejects.toThrow(/restaurants_detail_image/);
      // Spec §14.1 row 6: switching a page on for another restaurant (with its portrait) is a plain update.
      await sql(`UPDATE restaurants SET has_detail_page = true, detail_image_id = $1 WHERE id = 'the-fan'`, [await media('/assets/r-the-fan.jpg')]);
      await expect(sql(`UPDATE restaurants SET card_image_id = NULL WHERE id = 'danaksara'`)).rejects.toThrow(/restaurants_published_card/);
      await sql(`UPDATE restaurants SET card_image_id = NULL, is_published = false WHERE id = 'danaksara'`);
      await expect(sql(`UPDATE restaurants SET phone_e164 = '+84236000000' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_phone_pair/);
      await expect(sql(`UPDATE restaurants SET phone_e164 = '0236', phone_display = '0236' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_phone_e164_check/);
      await expect(sql(`UPDATE restaurants SET slug = 'taya-house' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_slug_key/);
      await expect(sql(`UPDATE restaurants SET slug = 'Phở Cuốn' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_slug_check/);
      await expect(sql(`UPDATE restaurants SET destination_id = 'atlantis' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_destination_id_fkey/);
      await expect(sql(`UPDATE restaurants SET map_url = 'http://maps.example' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_map_url_check/);
      // A restaurant added from phase 7 on fills only the new columns.
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('new-place', 'New Place', 'new-place', 'mm', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
    });

    it('restaurant_i18n: never blank, one menu (file or link), known locale', async () => {
      const set = (col: string, value: unknown) =>
        sql(`UPDATE restaurant_i18n SET ${col} = $1 WHERE restaurant_id = 'pho-cuon' AND locale = 'en'`, [value]);
      await expect(set('type_label', ' ')).rejects.toThrow(/restaurant_i18n_type_label_check/);
      await expect(set('story', 'x'.repeat(1501))).rejects.toThrow(/restaurant_i18n_story_check/);
      await expect(set('menu_pdf_url', 'http://x.pdf')).rejects.toThrow(/restaurant_i18n_menu_pdf_url_check/);
      await sql(`INSERT INTO media (storage, url, pathname, content_type, bytes) VALUES ('static', '/assets/menu.pdf', '/assets/menu.pdf', 'application/pdf', 10)`);
      await set('menu_pdf_media_id', await media('/assets/menu.pdf'));
      await expect(set('menu_pdf_url', 'https://x.pdf')).rejects.toThrow(/restaurant_i18n_one_menu/);
      await expect(sql(`INSERT INTO restaurant_i18n (restaurant_id, locale) VALUES ('pho-cuon', 'xx')`)).rejects.toThrow(/restaurant_i18n_locale_fkey/);
      // A Vietnamese row may hold only what is translated: the rest falls back to English per field.
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, type_label) VALUES ('pho-cuon', 'vi', 'Món Việt · Tầng 1')`);
    });

    it('cuisines: slug ids; a cuisine in use cannot go; a restaurant takes its links with it', async () => {
      await expect(sql(`INSERT INTO cuisines (id, image_id) VALUES ('Fusion Food', $1)`, [await media('/assets/chef.jpg')])).rejects.toThrow(/cuisines_id_check/);
      await expect(sql(`DELETE FROM cuisines WHERE id = 'thai'`)).rejects.toThrow(/restaurant_cuisines_cuisine_id_fkey/);
      await sql(`INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id) VALUES ('new-place', 'hotpot')`);
      await sql(`DELETE FROM restaurants WHERE id = 'new-place'`);
      expect(await one(`SELECT count(*)::int AS n FROM restaurant_cuisines WHERE restaurant_id = 'new-place'`)).toEqual({ n: 0 });
      // A slug change follows into the links.
      await sql(`UPDATE cuisines SET id = 'japanese-izakaya' WHERE id = 'japanese'`);
      expect(await one(`SELECT cuisine_id FROM restaurant_cuisines WHERE restaurant_id = 'hura-izakaya'`)).toEqual({ cuisine_id: 'japanese-izakaya' });
    });

    it('sections: the fixed keys; restaurants always shown; the film plays YouTube or Vimeo only', async () => {
      await expect(sql(`INSERT INTO sections (key) VALUES ('blog')`)).rejects.toThrow(/sections_key_check/);
      await expect(sql(`UPDATE sections SET is_visible = false WHERE key = 'restaurants'`)).rejects.toThrow(/sections_restaurants_visible/);
      await sql(`UPDATE sections SET is_visible = false WHERE key = 'stories'`);
      await expect(sql(`UPDATE sections SET link_url = 'https://example.com/film.mp4' WHERE key = 'film'`)).rejects.toThrow(/sections_film_video/);
      await sql(`UPDATE sections SET link_url = 'https://www.youtube.com/watch?v=abc' WHERE key = 'film'`);
      await sql(`UPDATE sections SET link_url = 'https://vimeo.com/123' WHERE key = 'film'`);
      await expect(sql(`UPDATE sections SET link_url = 'javascript:alert(1)' WHERE key = 'heritage'`)).rejects.toThrow(/sections_link_url_check/);
    });

    it('navigation: labels of at most 18 characters, one item per section, only to a section with an anchor of its own name', async () => {
      await expect(sql(`UPDATE nav_item_i18n SET label = $1 WHERE nav_item_id = 1`, ['Nhà hàng của chúng tôi'])).rejects.toThrow(
        /nav_item_i18n_label_check/,
      );
      await sql(`UPDATE nav_item_i18n SET label = $1 WHERE nav_item_id = 1`, ['x'.repeat(18)]);
      await expect(sql(`INSERT INTO nav_items (target_section) VALUES ('offers')`)).rejects.toThrow(/nav_items_target_section_key/);
      // The hero's anchor is #top and the booking bar's #reserve: an item for either would scroll nowhere
      // (test/guards/nav-anchors.guard.test.ts). The logo reaches the top, RESERVE opens the drawer.
      const refused: Record<string, string> = {};
      for (const key of ['film', 'finder', 'hero', 'booking_bar']) {
        refused[key] = await sql(`INSERT INTO nav_items (target_section) VALUES ($1)`, [key]).then(
          () => 'inserted',
          (e: Error) => e.message,
        );
      }
      expect(refused).toEqual({
        film: expect.stringMatching(/nav_items_target_section_check/),
        finder: expect.stringMatching(/nav_items_target_section_check/),
        hero: expect.stringMatching(/nav_items_target_section_check/),
        booking_bar: expect.stringMatching(/nav_items_target_section_check/),
      });
      await expect(sql(`INSERT INTO nav_items (target_section) VALUES ('blog')`)).rejects.toThrow(/nav_items_target_section_fkey/);
      await sql(`INSERT INTO nav_items (target_section) VALUES ('cuisines')`);
    });

    it('offers: a price has its basis, the dates run forward, a currency code', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { restaurant_id: 'taya-house', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO offers (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
      };
      await expect(add({ price_amount: 100 })).rejects.toThrow(/offers_price_pair/);
      await expect(add({ price_basis: 'net' })).rejects.toThrow(/offers_price_pair/);
      await expect(add({ price_amount: 100, price_basis: 'gross' })).rejects.toThrow(/offers_price_basis_check/);
      await expect(add({ price_amount: -1, price_basis: 'net' })).rejects.toThrow(/offers_price_amount_check/);
      await expect(add({ currency: 'vnd' })).rejects.toThrow(/offers_currency_check/);
      await expect(add({ valid_from: '2026-12-31', valid_until: '2026-12-01' })).rejects.toThrow(/offers_valid_range/);
      await add({ valid_from: '2026-12-01', valid_until: '2026-12-01', price_amount: 42.5, price_basis: 'net', currency: 'USD' });
      await add({}); // no price: the card shows the schedule alone
    });

    it('offers: a restaurant that still has an offer cannot be deleted (ON DELETE RESTRICT)', async () => {
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('pop-in', 'Pop-in', 'pop-in', 'mm', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
      const { id } = await one(`INSERT INTO offers (restaurant_id) VALUES ('pop-in') RETURNING id::int`);
      await expect(sql(`DELETE FROM restaurants WHERE id = 'pop-in'`)).rejects.toThrow(
        /violates RESTRICT setting of foreign key constraint "offers_restaurant_id_fkey"/,
      );
      // Its offers go first, one by one (each an audit_log row from phase 7), then the restaurant can.
      await sql(`DELETE FROM offers WHERE id = $1`, [id]);
      await sql(`DELETE FROM restaurants WHERE id = 'pop-in'`);
    });

    it('social links: known platforms, https, a non-empty language list or none', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { platform: 'zalo', href: 'https://zalo.me/furama', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO social_links (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
      };
      await expect(add({ platform: 'myspace' })).rejects.toThrow(/social_links_platform_check/);
      await expect(add({ href: 'http://zalo.me' })).rejects.toThrow(/social_links_href_check/);
      await expect(add({ visible_locales: [] })).rejects.toThrow(/social_links_visible_locales_check/);
      await expect(add({ visible_locales: ['vi', null] })).rejects.toThrow(/social_links_visible_locales_check/);
      await add({ visible_locales: ['vi'] });
    });

    it('site_settings: a known occasion, a sane autoplay, and a removed default restaurant falls back to NULL', async () => {
      await expect(sql(`UPDATE site_settings SET default_occasion = 'Brunch'`)).rejects.toThrow(/site_settings_default_occasion_check/);
      await expect(sql(`UPDATE site_settings SET hero_autoplay_ms = 500`)).rejects.toThrow(/site_settings_hero_autoplay_ms_check/);
      await expect(sql(`UPDATE site_settings SET default_restaurant_id = 'atlantis'`)).rejects.toThrow(/site_settings_default_restaurant_id_fkey/);
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('pop-up', 'Pop-up', 'pop-up', 'resort', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
      await sql(`UPDATE site_settings SET default_restaurant_id = 'pop-up'`);
      await sql(`DELETE FROM restaurants WHERE id = 'pop-up'`);
      expect(await one(`SELECT default_restaurant_id FROM site_settings`)).toEqual({ default_restaurant_id: null });
    });

    it('translations of a removed language go with it; a renamed language follows', async () => {
      await sql(`INSERT INTO offer_i18n (offer_id, locale, title) VALUES (1, 'vi', 'Buffet hải sản')`);
      await sql(`UPDATE locales SET code = 'vi-vn' WHERE code = 'vi'`);
      expect(await one(`SELECT locale FROM offer_i18n WHERE offer_id = 1 AND locale <> 'en'`)).toEqual({ locale: 'vi-vn' });
      await sql(`DELETE FROM locales WHERE code = 'vi-vn'`);
      expect(await one(`SELECT count(*)::int AS n FROM offer_i18n WHERE locale <> 'en'`)).toEqual({ n: 0 });
    });
  });
});
