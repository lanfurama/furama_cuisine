import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as DATA from '@/lib/data';
import { imageSize, jpegIsRotated } from '@/lib/media/image-size';
import {
  CUISINES_AT_8FE98F5,
  DESTINATIONS_AT_8FE98F5,
  DETAIL_PAGES_AT_8FE98F5,
  EXPERIENCES_AT_8FE98F5,
  HERO_AUTOPLAY_MS_AT_8FE98F5,
  HERO_SLIDES_AT_8FE98F5,
  NAV_AT_8FE98F5,
  OFFERS_AT_8FE98F5,
  SECTIONS_AT_8FE98F5,
  SETTINGS_AT_8FE98F5,
  SOCIALS_AT_8FE98F5,
  STORIES_AT_8FE98F5,
} from '../fixtures/phase5-content';
import { TEST_DATABASE_URL, databaseUrl, resetDatabase } from '../helpers/db';

/*
 * Spec §14.1 row 6: "the web is identical to before". Migration 008 must seed
 * exactly the content of 8fe98f5. Three links of one chain:
 *   1. the frozen snapshot (test/fixtures/phase5-content.ts) is what lib/data.ts
 *      and the components held — this block goes when phase 6 deletes them;
 *   2. the database holds the snapshot, rebuilt into the strings a guest reads;
 *   3. every media row is a real file in public/assets, measured.
 * Restaurants were already rows (002): their new columns are compared with
 * their phase-1 columns in the same database, which also holds on Neon.
 * A database of its own, freshly migrated: other files edit the shared one.
 */

const ASSETS = join(process.cwd(), 'public', 'assets');
const url = databaseUrl('furama_cuisine_seed008_test');
let pool: Pool;
const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;

/** "9 Sep 2026": English day-first with a three-letter month. en-GB says "Sept" (seen on Node 22.22, ICU 77.1), so take en-US's parts. */
function dayFirst(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .formatToParts(new Date(`${iso}T00:00:00Z`))
      .map((part) => [part.type, part.value]),
  );
  return `${p.day} ${p.month} ${p.year}`;
}

/** "VND 888,000++ per guest": the number alone through Intl (currency style would put U+00A0 after the code). */
function price(amount: string, currency: string, basis: string): string {
  return `${currency} ${new Intl.NumberFormat('en').format(Number(amount))}${basis === 'plus_plus' ? '++' : ' net'} per guest`;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ');
const source = (path: string) => collapse(readFileSync(path, 'utf8'));

describe('the snapshot is the content of 8fe98f5 (delete with the constants and literals it mirrors)', () => {
  it('matches lib/data.ts', () => {
    expect(CUISINES_AT_8FE98F5).toEqual(DATA.CUISINES);
    expect(DESTINATIONS_AT_8FE98F5.filter((d) => d.name).map((d) => [d.id, d.name])).toEqual(Object.entries(DATA.DESTS));
    expect(
      DESTINATIONS_AT_8FE98F5.map((d) => ({ key: d.id, slot: d.image.slice(8, -4), title: d.title, blurb: d.blurb })),
    ).toEqual(DATA.DESTINATION_CARDS);
    expect(HERO_SLIDES_AT_8FE98F5.map((s) => s.image)).toEqual(DATA.HERO_SLIDES.map((s) => `/assets/${s.img}.jpg`));
    expect(EXPERIENCES_AT_8FE98F5).toEqual(DATA.EXPERIENCES);
    expect(STORIES_AT_8FE98F5).toEqual(
      DATA.STORIES.map(({ img, kicker, title, href }) => ({ image: `/assets/${img}.jpg`, kicker, title, href })),
    );
    expect(OFFERS_AT_8FE98F5).toEqual(DATA.OFFERS);
    expect(Object.keys(DETAIL_PAGES_AT_8FE98F5)).toEqual([...DATA.DETAIL_PAGE_IDS]);
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    expect(taya.seo).toEqual(DATA.DETAIL_SEO['taya-house']);
    expect(taya.menuPdf).toBe(DATA.CONTACT.tariffPdf);
    expect({ tel: taya.call, map: taya.map }).toEqual(DATA.contactFor('resort'));
    expect(taya.highlights).toEqual(
      DATA.TAYA_EXPERIENCES.map(({ img, alt, title, detail }) => ({ image: `/assets/${img}.jpg`, alt, title, detail })),
    );
    expect(NAV_AT_8FE98F5.map((n) => ({ label: n.header, target: n.target }))).toEqual(DATA.NAV_LINKS);
    expect(SOCIALS_AT_8FE98F5.map(({ label, href }) => ({ label, href }))).toEqual(DATA.SOCIALS);
    expect(SETTINGS_AT_8FE98F5.email).toBe(DATA.CONTACT.email);
    expect(SETTINGS_AT_8FE98F5.defaultRestaurantId).toBe(DATA.DEFAULT_RESTAURANT_ID);
    expect(SECTIONS_AT_8FE98F5.heritage.link).toBe(DATA.CONTACT.story);
    expect(DESTINATIONS_AT_8FE98F5[0].footer.endsWith(DATA.CONTACT.resortPhoneLabel)).toBe(true);
    expect(DESTINATIONS_AT_8FE98F5[1].footer.endsWith(DATA.CONTACT.diningHousePhoneLabel)).toBe(true);
  });

  it('matches the copy written into the components', () => {
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    const tayaHero = source('components/detail/TayaHero.tsx');
    expect(tayaHero.split(taya.kicker)).toHaveLength(3); // desktop and phone copies
    expect(tayaHero.split(taya.story)).toHaveLength(3);
    expect(tayaHero).toContain(`<img src="${taya.portrait}" alt="${taya.portraitAlt}"`);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('migration 008 seeds exactly the content of 8fe98f5 (database)', () => {
  beforeAll(() => {
    resetDatabase(url);
    pool = new Pool({ connectionString: url, max: 2 });
  });
  afterAll(() => pool.end());

  /** What a guest's <img alt> says for each file: "" when decorative or without English alt text. */
  async function alts(): Promise<Map<string, string>> {
    const list = await rows<{ pathname: string; is_decorative: boolean; alt: string | null }>(
      `SELECT m.pathname, m.is_decorative, mi.alt
         FROM media m LEFT JOIN media_i18n mi ON mi.media_id = m.id AND mi.locale = 'en'`,
    );
    return new Map(list.map((m) => [m.pathname, m.is_decorative ? '' : (m.alt ?? '')]));
  }

  it('cuisines: slug, label, order and image, drawn as decoration', async () => {
    const list = await rows<{ id: string; label: string; image: string }>(
      `SELECT c.id, ci.label, m.pathname AS image
         FROM cuisines c
         JOIN cuisine_i18n ci ON ci.cuisine_id = c.id AND ci.locale = 'en'
         JOIN media m ON m.id = c.image_id
        WHERE c.is_published
        ORDER BY c.sort_order, c.id`,
    );
    expect(list.map((c) => [c.label, c.id])).toEqual(CUISINES_AT_8FE98F5);
    expect(list.map((c) => c.image)).toEqual(CUISINES_AT_8FE98F5.map(([, slug]) => `/assets/cuisine-${slug}.jpg`));
    const alt = await alts();
    expect(list.map((c) => alt.get(c.image))).toEqual(list.map(() => ''));
  });

  it('destinations: card lines, picture, name, and the footer line from name, address and phone', async () => {
    const list = await rows<{
      id: string; name: string | null; t1: string; t2: string; b1: string; b2: string; image: string;
      address: string | null; phone_display: string | null; phone_e164: string | null; show_in_footer: boolean;
    }>(
      `SELECT d.id, di.name, di.card_title_1 AS t1, di.card_title_2 AS t2, di.card_blurb_1 AS b1, di.card_blurb_2 AS b2,
              m.pathname AS image, di.address, d.phone_display, d.phone_e164, d.show_in_footer
         FROM destinations d
         JOIN destination_i18n di ON di.destination_id = d.id AND di.locale = 'en'
         JOIN media m ON m.id = d.card_image_id
        WHERE d.is_published
        ORDER BY d.sort_order, d.id`,
    );
    expect(
      list.map((d) => ({
        id: d.id,
        name: d.name,
        title: [d.t1, d.t2],
        blurb: [d.b1, d.b2],
        image: d.image,
        footer: d.show_in_footer ? `${d.name} · ${d.address} · ${d.phone_display}` : null,
      })),
    ).toEqual(DESTINATIONS_AT_8FE98F5);
    expect((await alts()).get('/assets/dest-resort.jpg')).toBe('');
    // The footer's tel: link becomes E.164 (CONTACT.diningHousePhone was the national 0859555759).
    expect(list.find((d) => d.id === 'dining-house')?.phone_e164).toBe(`+84${DATA.CONTACT.diningHousePhone.slice(1)}`);
  });

  it('restaurants: slug, destination, type label, cuisines and card image, from their phase-1 columns', async () => {
    const list = await rows<{
      id: string; name: string; type: string; destination: string; cuisines: string[];
      slug: string; destination_id: string; type_label: string; cuisine_ids: string[]; card: string;
      is_published: boolean; archived_at: Date | null; phone_e164: string | null; map_url: string | null;
    }>(
      `SELECT r.id, r.name, r.type, r.destination, r.cuisines, r.slug, r.destination_id, ri.type_label,
              ARRAY(SELECT rc.cuisine_id FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id ORDER BY rc.sort_order) AS cuisine_ids,
              m.pathname AS card, r.is_published, r.archived_at, r.phone_e164, r.map_url
         FROM restaurants r
         JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
         JOIN media m ON m.id = r.card_image_id
        ORDER BY r.sort_order, r.id`,
    );
    expect(list).toHaveLength(12);
    const slugOf = new Map(CUISINES_AT_8FE98F5.map(([label, slug]) => [label, slug]));
    const alt = await alts();
    for (const r of list) {
      expect(r).toMatchObject({
        slug: r.id,
        destination_id: r.destination,
        type_label: r.type,
        cuisine_ids: r.cuisines.map((label) => slugOf.get(label)),
        card: `/assets/r-${r.id}.jpg`,
        is_published: true,
        archived_at: null,
        // Their own number and map are empty: CALL and MAP come from the destination, as contactFor did.
        phone_e164: null,
        map_url: null,
      });
      expect(alt.get(r.card)).toBe(r.name);
    }
  });

  it('the detail page: Tàya House only, with its copy, portrait, SEO, menu, highlights, CALL and MAP', async () => {
    const pages = await rows<{
      id: string; kicker: string; story: string; story_label: string | null; highlights_title: string | null;
      portrait: string; seo_title: string; seo_description: string; menu_pdf_url: string; menu_pdf_media_id: string | null;
      tel: string; map: string;
    }>(
      `SELECT r.id, ri.detail_kicker AS kicker, ri.story, ri.story_label, ri.highlights_title, m.pathname AS portrait,
              ri.seo_title, ri.seo_description, ri.menu_pdf_url, ri.menu_pdf_media_id,
              COALESCE(r.phone_e164, d.phone_e164) AS tel, COALESCE(r.map_url, d.map_url) AS map
         FROM restaurants r
         JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
         JOIN destinations d ON d.id = r.destination_id
         JOIN media m ON m.id = r.detail_image_id
        WHERE r.has_detail_page
        ORDER BY r.sort_order`,
    );
    expect(pages.map((p) => p.id)).toEqual(Object.keys(DETAIL_PAGES_AT_8FE98F5));
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    expect(pages[0]).toEqual({
      id: 'taya-house',
      kicker: taya.kicker,
      story: taya.story,
      // NULL: the registry's "Brand Story" and "At {name}".
      story_label: null,
      highlights_title: null,
      portrait: taya.portrait,
      seo_title: taya.seo.title,
      seo_description: taya.seo.description,
      menu_pdf_url: taya.menuPdf,
      menu_pdf_media_id: null,
      tel: taya.call,
      map: taya.map,
    });
    const alt = await alts();
    expect(alt.get(taya.portrait)).toBe(taya.portraitAlt);
    const highlights = await rows<{ image: string; title: string; detail: string }>(
      `SELECT m.pathname AS image, hi.title, hi.detail
         FROM restaurant_highlights h
         JOIN restaurant_highlight_i18n hi ON hi.highlight_id = h.id AND hi.locale = 'en'
         JOIN media m ON m.id = h.image_id
        WHERE h.restaurant_id = 'taya-house' AND h.is_published
        ORDER BY h.sort_order, h.id`,
    );
    expect(highlights.map((h) => ({ ...h, alt: alt.get(h.image) }))).toEqual(
      taya.highlights.map(({ image, alt: a, title, detail }) => ({ image, title, detail, alt: a })),
    );
    // Another restaurant shows the reserve drawer, as before: none has highlights or page copy.
    expect(await rows(`SELECT 1 FROM restaurant_highlights WHERE restaurant_id <> 'taya-house'`)).toEqual([]);
    expect(
      await rows(
        `SELECT 1 FROM restaurant_i18n WHERE restaurant_id <> 'taya-house'
            AND num_nonnulls(detail_kicker, story, story_label, highlights_title, menu_pdf_url, menu_pdf_media_id, seo_title, seo_description) > 0`,
      ),
    ).toEqual([]);
  });

  it('hero slides with the phone crop and alt text, every section on, and their pictures and links', async () => {
    const slides = await rows<{ image: string; mobile: string | null }>(
      `SELECT m.pathname AS image, mm.pathname AS mobile
         FROM hero_slides s
         JOIN media m ON m.id = s.image_id
         LEFT JOIN media mm ON mm.id = s.image_mobile_id
        WHERE s.is_published
        ORDER BY s.sort_order, s.id`,
    );
    const alt = await alts();
    expect(slides.map((s) => ({ ...s, alt: alt.get(s.image) }))).toEqual(HERO_SLIDES_AT_8FE98F5);
    expect(alt.get('/assets/hero-hall-m.jpg')).toBe(HERO_SLIDES_AT_8FE98F5[0].alt);

    const sections = await rows<{ key: string; is_visible: boolean; image: string | null; link_url: string | null }>(
      `SELECT s.key, s.is_visible, m.pathname AS image, s.link_url FROM sections s LEFT JOIN media m ON m.id = s.image_id ORDER BY s.key`,
    );
    expect(sections.every((s) => s.is_visible)).toBe(true);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    expect(byKey.film).toMatchObject({ image: SECTIONS_AT_8FE98F5.film.image, link_url: SECTIONS_AT_8FE98F5.film.link });
    expect(byKey.experiences).toMatchObject({ image: SECTIONS_AT_8FE98F5.experiences.image, link_url: null });
    expect(alt.get(SECTIONS_AT_8FE98F5.experiences.image)).toBe(SECTIONS_AT_8FE98F5.experiences.alt);
    expect(byKey.heritage).toMatchObject({ image: SECTIONS_AT_8FE98F5.heritage.image, link_url: SECTIONS_AT_8FE98F5.heritage.link });
    expect(alt.get(SECTIONS_AT_8FE98F5.heritage.image)).toBe(SECTIONS_AT_8FE98F5.heritage.alt);
    expect(sections.filter((s) => !['film', 'experiences', 'heritage'].includes(s.key)).map((s) => [s.image, s.link_url])).toEqual(
      Array.from({ length: 8 }, () => [null, null]),
    );
  });

  it('experiences, and stories whose kicker is rebuilt from the category and the date', async () => {
    const experiences = await rows<{ title: string; blurb: string; link_url: string | null }>(
      `SELECT ei.title, ei.blurb, e.link_url
         FROM experiences e JOIN experience_i18n ei ON ei.experience_id = e.id AND ei.locale = 'en'
        WHERE e.is_published ORDER BY e.sort_order, e.id`,
    );
    expect(experiences.map(({ title, blurb }) => ({ title, blurb }))).toEqual(EXPERIENCES_AT_8FE98F5);
    expect(experiences.every((e) => e.link_url === null)).toBe(true); // still "#experiences"

    const stories = await rows<{ image: string; category: string; published_on: string | null; title: string; href: string }>(
      `SELECT m.pathname AS image, si.category, s.published_on::text AS published_on, si.title, COALESCE(si.href, s.href) AS href
         FROM stories s
         JOIN story_i18n si ON si.story_id = s.id AND si.locale = 'en'
         JOIN media m ON m.id = s.image_id
        WHERE s.is_published ORDER BY s.sort_order, s.id`,
    );
    expect(
      stories.map((s) => ({
        image: s.image,
        kicker: s.published_on ? `${s.category} · ${dayFirst(s.published_on)}` : s.category,
        title: s.title,
        href: s.href,
      })),
    ).toEqual(STORIES_AT_8FE98F5);
    const alt = await alts();
    expect(stories.map((s) => alt.get(s.image))).toEqual(['', '', '', '']);
  });

  it('offers: venue, title, the detail rebuilt from price and schedule, the restaurant, no expiry', async () => {
    const offers = await rows<{
      restaurant_id: string; venue: string; title: string; schedule: string; price_amount: string;
      currency: string; price_basis: string; valid_from: string | null; valid_until: string | null;
    }>(
      `SELECT o.restaurant_id, COALESCE(oi.venue_override, r.name) AS venue, oi.title, oi.schedule,
              o.price_amount, o.currency, o.price_basis, o.valid_from::text, o.valid_until::text
         FROM offers o
         JOIN offer_i18n oi ON oi.offer_id = o.id AND oi.locale = 'en'
         JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.is_published ORDER BY o.sort_order, o.id`,
    );
    expect(
      offers.map((o) => ({
        venue: o.venue,
        title: o.title,
        detail: `${price(o.price_amount, o.currency, o.price_basis)} · ${o.schedule}`,
        restaurant: o.restaurant_id,
        note: `Offer: ${o.title}`,
      })),
    ).toEqual(OFFERS_AT_8FE98F5);
    expect(offers.map((o) => [o.valid_from, o.valid_until])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it('navigation, social links and the site settings', async () => {
    const nav = await rows<{ target_section: string; label: string }>(
      `SELECT n.target_section, ni.label FROM nav_items n JOIN nav_item_i18n ni ON ni.nav_item_id = n.id AND ni.locale = 'en'
        WHERE n.is_published ORDER BY n.sort_order, n.id`,
    );
    // One label: the menu shows it, the header shows it in capitals (CSS text-transform).
    expect(nav.map((n) => ({ target: n.target_section, header: n.label.toUpperCase(), menu: n.label }))).toEqual(NAV_AT_8FE98F5);

    const socials = await rows<{ platform: string; href: string; visible_locales: string[] | null }>(
      `SELECT platform, href, visible_locales FROM social_links WHERE is_published ORDER BY sort_order, id`,
    );
    expect(socials.map((s) => ({ platform: s.platform, label: s.platform.toUpperCase(), href: s.href }))).toEqual(SOCIALS_AT_8FE98F5);
    expect(socials.every((s) => s.visible_locales === null)).toBe(true);

    expect(await rows(`SELECT email, default_restaurant_id, default_occasion, og_image_id, hero_autoplay_ms FROM site_settings`)).toEqual([
      {
        email: SETTINGS_AT_8FE98F5.email,
        default_restaurant_id: SETTINGS_AT_8FE98F5.defaultRestaurantId,
        default_occasion: SETTINGS_AT_8FE98F5.defaultOccasion,
        og_image_id: null,
        hero_autoplay_ms: HERO_AUTOPLAY_MS_AT_8FE98F5,
      },
    ]);
  });

  it('seeds English only, reviewed, origin seed (spec §5.1 item 4)', async () => {
    const tables = [
      'media_i18n', 'destination_i18n', 'cuisine_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n',
      'experience_i18n', 'story_i18n', 'offer_i18n', 'nav_item_i18n',
    ];
    for (const table of tables) {
      const [summary] = await rows<{ n: number; other: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE locale <> 'en' OR status <> 'reviewed' OR origin <> 'seed')::int AS other FROM ${table}`,
      );
      expect({ table, ...summary }).toMatchObject({ table, other: 0 });
      expect(summary.n).toBeGreaterThan(0);
    }
    // Section copy and UI text stay registry defaults: no content_strings row.
    expect(await rows(`SELECT key FROM content_strings`)).toEqual([]);
  });

  it('marks as decorative exactly the images drawn with alt="", so the phase-9 alt generator leaves them alone', async () => {
    const decorative = [
      ...CUISINES_AT_8FE98F5.map(([, slug]) => `/assets/cuisine-${slug}.jpg`),
      ...DESTINATIONS_AT_8FE98F5.map((d) => d.image),
      ...STORIES_AT_8FE98F5.map((s) => s.image),
      SECTIONS_AT_8FE98F5.heritage.image,
      ...HERO_SLIDES_AT_8FE98F5.filter((s) => s.alt === '').map((s) => s.image),
    ].sort();
    expect((await rows<{ pathname: string }>(`SELECT pathname FROM media WHERE is_decorative ORDER BY pathname`)).map((m) => m.pathname)).toEqual(
      decorative,
    );
    // Every other file has English alt text.
    expect(await rows(`SELECT pathname FROM media m WHERE NOT is_decorative AND NOT EXISTS (SELECT 1 FROM media_i18n mi WHERE mi.media_id = m.id AND mi.locale = 'en')`)).toEqual([]);
    expect(await rows(`SELECT pathname FROM media m WHERE is_decorative AND EXISTS (SELECT 1 FROM media_i18n mi WHERE mi.media_id = m.id)`)).toEqual([]);
  });

  it('has a row for every file in public/assets, measured from the file, and nothing else', async () => {
    const media = await rows<{
      storage: string; url: string; pathname: string; content_type: string; width: number; height: number; bytes: number;
      blur_data_url: string | null; deleted_at: Date | null;
    }>(`SELECT storage, url, pathname, content_type, width, height, bytes, blur_data_url, deleted_at FROM media ORDER BY pathname`);
    const files = readdirSync(ASSETS).filter((f) => !f.startsWith('.')).sort();
    expect(media.map((m) => m.pathname)).toEqual(files.map((f) => `/assets/${f}`));
    for (const m of media) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'public', m.pathname)));
      const size = imageSize(bytes);
      expect({ path: m.pathname, storage: m.storage, url: m.url, type: m.content_type, w: m.width, h: m.height, bytes: m.bytes }).toEqual({
        path: m.pathname, storage: 'static', url: m.pathname, type: size?.contentType, w: size?.width, h: size?.height, bytes: bytes.length,
      });
      expect(jpegIsRotated(bytes)).toBe(false);
      // No blur placeholder: drawing one would change the pages (phase 7 decides).
      expect(m.blur_data_url).toBeNull();
      expect(m.deleted_at).toBeNull();
    }
  });
});
