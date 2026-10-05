import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { homeSections } from '@/lib/content/home-sections';
import { FALLBACK_PHONE } from '@/lib/data';
import { loadExperiences, loadHeroSlides, loadOffers, loadStories } from '@/lib/server/content/home.queries';
import { loadDetailSlugs, loadRestaurantDetail, loadRestaurants } from '@/lib/server/content/restaurants.queries';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
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

/*
 * The guest site's content loaders (lib/server/content/*.queries.ts) against
 * migration 008's seed. The expected values are the frozen content of phase 5
 * (test/fixtures/phase5-content.ts), so a loader that drifts from what the
 * site rendered fails here as well as in the visual baselines. Then the rules:
 * language fallback per field (spec §5.1 item 5), machine translations behind
 * serve_machine, unpublished rows, nav items following their section, and
 * offers shown by the date in Da Nang.
 */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
/** Today in Da Nang plus `days`, as SQL (the day offers are shown for). */
const venueDay = (days: number) => `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${days}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', () => {
  afterEach(async () => {
    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n', 'experience_i18n', 'story_i18n', 'offer_i18n']) {
      await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
    }
    await sql(`UPDATE locales SET serve_machine = false WHERE code = 'vi'`);
    await sql(`UPDATE sections SET is_visible = true`);
    await sql(`UPDATE cuisines SET is_published = true`);
    await sql(`UPDATE destinations SET is_published = true`);
    await sql(`UPDATE nav_items SET is_published = true`);
    await sql(`UPDATE social_links SET is_published = true, visible_locales = NULL`);
    await sql(`UPDATE experiences SET is_published = true`);
    await sql(`UPDATE stories SET is_published = true`);
    await sql(`UPDATE hero_slides SET is_published = true`);
    await sql(`UPDATE offers SET is_published = true, valid_from = NULL, valid_until = NULL`);
    await sql(`UPDATE offers SET price_amount = 450000, price_basis = 'net' WHERE id = 3`);
    await sql(`UPDATE offer_i18n SET venue_override = NULL`);
    await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL, phone_e164 = NULL, phone_display = NULL, map_url = NULL`);
    await sql(`DELETE FROM restaurant_highlights WHERE restaurant_id <> 'taya-house'`);
    await sql(`UPDATE restaurants SET has_detail_page = false, detail_image_id = NULL WHERE id <> 'taya-house'`);
    await sql(`DELETE FROM restaurant_i18n WHERE locale <> 'en'`);
    await sql(
      `UPDATE restaurant_i18n SET detail_kicker = NULL, story = NULL, menu_pdf_url = NULL WHERE restaurant_id <> 'taya-house'`,
    );
    await sql(`UPDATE media SET deleted_at = NULL WHERE storage = 'static'`);
    await sql(`DELETE FROM media WHERE pathname LIKE '/assets/test-l73-%'`);
  });
  afterAll(() => getPool().end());

  describe('the seed is the content of phase 5', () => {
    it('cuisines: the rail in order, each with its picture and an empty alt (the label beside it says it)', async () => {
      const cuisines = await loadCuisines('en');
      expect(cuisines.map((c) => [c.label, c.id])).toEqual(CUISINES_AT_8FE98F5);
      for (const c of cuisines) expect(c.image).toMatchObject({ url: `/assets/cuisine-${c.id}.jpg`, alt: '' });
    });

    it('destinations: the four cards, the dropdown names and the footer lines', async () => {
      const ds = await loadDestinations('en');
      expect(ds.map((d) => [d.id, d.name, d.cardTitle, d.cardBlurb, d.image?.url, d.image?.alt])).toEqual(
        DESTINATIONS_AT_8FE98F5.map((d) => [d.id, d.name, d.title, d.blurb, d.image, '']),
      );
      expect(ds.map((d) => d.kind)).toEqual(['venue', 'venue', 'venue', 'teaser']);
      // Printed as the site printed it; the Dining House now dials in E.164 (R18; the owner confirmed the number on 2026-10-03, spec §15 item 14).
      expect(ds.filter((d) => d.showInFooter).map((d) => `${d.name} · ${d.address} · ${d.phone?.display}`)).toEqual(
        DESTINATIONS_AT_8FE98F5.flatMap((d) => (d.footer ? [d.footer] : [])),
      );
      expect(ds.filter((d) => d.showInFooter).map((d) => d.phone?.tel)).toEqual(['+842366519999', '+84859555759']);
      // The error pages print FALLBACK_PHONE without asking the database (spec §12): it is the resort's number.
      expect(ds.find((d) => d.id === 'resort')?.phone).toEqual({ tel: FALLBACK_PHONE.tel, display: FALLBACK_PHONE.display });
    });

    it('nav: the header’s targets with the menu’s labels, stored once in natural case', async () => {
      expect(await loadNav('en')).toEqual(NAV_AT_8FE98F5.map((n) => ({ target: n.target, label: n.menu })));
    });

    it('social links and the site settings', async () => {
      expect(await loadSocials('en')).toEqual(SOCIALS_AT_8FE98F5.map(({ platform, href }) => ({ platform, href })));
      expect(await loadSiteSettings()).toMatchObject({
        ...SETTINGS_AT_8FE98F5,
        heroAutoplayMs: HERO_AUTOPLAY_MS_AT_8FE98F5,
        ogImageId: null,
        token: expect.stringMatching(/^\d+$/),
      });
    });

    it('sections: every one on; the chef, the heritage picture and its link, the film poster', async () => {
      const s = await loadSections('en');
      expect(Object.values(s).every((x) => x.visible)).toBe(true);
      expect(s.experiences).toMatchObject({
        image: { url: SECTIONS_AT_8FE98F5.experiences.image, alt: SECTIONS_AT_8FE98F5.experiences.alt, width: 456, height: 378 },
        link: null,
      });
      expect(s.heritage).toMatchObject({ image: { url: SECTIONS_AT_8FE98F5.heritage.image, alt: '' }, link: SECTIONS_AT_8FE98F5.heritage.link });
      expect(s.film).toMatchObject({ image: { url: SECTIONS_AT_8FE98F5.film.image }, link: null });
      expect(s.hero).toEqual({ visible: true, image: null, link: null });
      // The static files have no blur placeholder: the picture is exactly phase 6's (no placeholder="blur").
      expect(Object.keys(s.experiences.image!).sort()).toEqual(['alt', 'height', 'url', 'width']);
    });

    it('hero slides: the three pictures in order, the first with its phone crop and the only alt text', async () => {
      const slides = await loadHeroSlides('en');
      expect(slides.map((h) => ({ image: h.image.url, mobile: h.mobile?.url ?? null, alt: h.image.alt }))).toEqual(HERO_SLIDES_AT_8FE98F5);
      expect(slides[0].image).toMatchObject({ width: 906, height: 515 });
    });

    it('experiences: the three rows, linking nowhere yet (spec §15 item 16)', async () => {
      expect((await loadExperiences('en')).map(({ title, blurb, href }) => ({ title, blurb, href }))).toEqual(
        EXPERIENCES_AT_8FE98F5.map((e) => ({ ...e, href: null })),
      );
    });

    it('stories: picture, kicker rebuilt from the category and the date ("9 Sep 2026"), title and link', async () => {
      expect((await loadStories('en')).map((s) => ({ image: s.image?.url, kicker: s.kicker, title: s.title, href: s.href }))).toEqual(
        STORIES_AT_8FE98F5,
      );
      for (const s of await loadStories('en')) expect(s.image?.alt).toBe('');
    });

    it('offers: the three cards as the site drew them, the detail line rebuilt from the price and the schedule', async () => {
      expect((await loadOffers('en')).map(({ venue, title, detail, restaurantId }) => ({ venue, title, detail, restaurantId }))).toEqual(
        OFFERS_AT_8FE98F5.map(({ venue, title, detail, restaurant }) => ({ venue, title, detail, restaurantId: restaurant })),
      );
      expect((await loadOffers('en')).map((o) => o.id)).toEqual([1, 2, 3]);
    });
  });

  describe('offers by date (spec §6.2)', () => {
    it('shows an offer from its valid_from to its valid_until, both days included, by the date in Da Nang', async () => {
      await sql(`UPDATE offers SET valid_until = ${venueDay(0)} WHERE id = 1`);
      await sql(`UPDATE offers SET valid_from = ${venueDay(0)} WHERE id = 2`);
      expect((await loadOffers('en')).map((o) => o.id)).toEqual([1, 2, 3]);
      await sql(`UPDATE offers SET valid_until = ${venueDay(-1)} WHERE id = 1`);
      await sql(`UPDATE offers SET valid_from = ${venueDay(1)} WHERE id = 2`);
      expect((await loadOffers('en')).map((o) => o.id)).toEqual([3]);
    });

    it('an offer without a price is its schedule alone', async () => {
      await sql(`UPDATE offers SET price_amount = NULL, price_basis = NULL WHERE id = 3`);
      expect((await loadOffers('en')).find((o) => o.id === 3)?.detail).toBe('~30 pastries, 12+ teas');
    });
  });

  describe('restaurant pages (spec §6.4, §14.1 row 6)', () => {
    /** Switches a restaurant's page on as the acceptance spec does: a portrait, a kicker, an English story. */
    async function openPage(id: string, portrait: string) {
      await sql(`UPDATE restaurants SET has_detail_page = true, detail_image_id = (SELECT id FROM media WHERE pathname = $2) WHERE id = $1`, [
        id,
        portrait,
      ]);
      await sql(`UPDATE restaurant_i18n SET detail_kicker = 'A kicker', story = 'A story.' WHERE restaurant_id = $1 AND locale = 'en'`, [id]);
    }

    it('Tàya House’s page is the one the site drew: copy, portrait, SEO, menu, the resort’s CALL and MAP, the four highlights', async () => {
      const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
      const d = await loadRestaurantDetail('taya-house', 'en');
      expect(d).toMatchObject({
        id: 'taya-house',
        slug: 'taya-house',
        name: 'Tàya House',
        destinationName: 'Furama Resort Danang',
        kicker: taya.kicker,
        story: taya.story,
        storyLabel: null,
        highlightsTitle: null,
        portrait: { url: taya.portrait, alt: taya.portraitAlt },
        bookingEnabled: true,
        menu: { kind: 'pdf', url: taya.menuPdf },
        phone: { tel: taya.call, display: '+84 236 651 9999' },
        map: taya.map,
        seo: taya.seo,
      });
      expect(d?.highlights.map((h) => ({ image: h.image.url, alt: h.image.alt, title: h.title, detail: h.detail }))).toEqual(taya.highlights);
      expect(await loadDetailSlugs()).toEqual(['taya-house']);
    });

    it('none for a restaurant without has_detail_page, an unknown slug, an unpublished or an archived one', async () => {
      expect(await loadRestaurantDetail('danaksara', 'en')).toBeNull();
      expect(await loadRestaurantDetail('nope', 'en')).toBeNull();
      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'taya-house'`);
      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
      expect(await loadDetailSlugs()).toEqual([]);
      await sql(`UPDATE restaurants SET is_published = true, archived_at = now() WHERE id = 'taya-house'`);
      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
    });

    it('switching has_detail_page on for another restaurant gives it a page: its destination’s CALL, no MAP, MENU to its highlights or none', async () => {
      await openPage('the-fan', '/assets/r-the-fan.jpg');
      expect(await loadDetailSlugs()).toEqual(['taya-house', 'the-fan']);
      expect(await loadRestaurantDetail('the-fan', 'en')).toMatchObject({
        name: 'Steakhouse The Fan',
        destinationName: 'Furama Dining House',
        kicker: 'A kicker',
        story: 'A story.',
        portrait: { url: '/assets/r-the-fan.jpg', alt: 'Steakhouse The Fan' },
        phone: { tel: '+84859555759', display: '0859 555 759' },
        map: null,
        menu: null,
        highlights: [],
        seo: { title: null, description: null },
      });
      await sql(
        `INSERT INTO restaurant_highlights (restaurant_id, image_id) SELECT 'the-fan', id FROM media WHERE pathname = '/assets/story-the-fan.jpg'`,
      );
      // A highlight without its English title shows nothing, so it is left out.
      expect((await loadRestaurantDetail('the-fan', 'en'))?.highlights).toEqual([]);
      await sql(
        `INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail)
         SELECT id, 'en', 'The Art Floor', 'Dinner among the paintings' FROM restaurant_highlights WHERE restaurant_id = 'the-fan'`,
      );
      expect(await loadRestaurantDetail('the-fan', 'en')).toMatchObject({
        menu: { kind: 'scroll' },
        highlights: [{ title: 'The Art Floor', detail: 'Dinner among the paintings', image: { url: '/assets/story-the-fan.jpg', alt: '' } }],
      });
    });

    it('a restaurant’s own number and map beat its destination’s; a destination without them hides the buttons', async () => {
      await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333', map_url = 'https://maps.example/taya' WHERE id = 'taya-house'`);
      expect(await loadRestaurantDetail('taya-house', 'en')).toMatchObject({
        phone: { tel: '+842363847333', display: '0236 3847 333' },
        map: 'https://maps.example/taya',
      });
      await openPage('chaoshan-hotpot', '/assets/r-chaoshan-hotpot.jpg');
      expect(await loadRestaurantDetail('chaoshan-hotpot', 'en')).toMatchObject({ phone: null, map: null, destinationName: 'Furama MM Supercenter' });
    });

    it('L7-3: "has a page" is one predicate: a portrait in the trash, or an archived restaurant, takes away the page, its slug and the card’s link together', async () => {
      const tayaCard = async () => (await loadRestaurants('en')).find((r) => r.id === 'taya-house');
      expect((await tayaCard())?.hasDetailPage).toBe(true);
      await sql(`UPDATE media SET deleted_at = now() WHERE pathname = '/assets/taya-hero.jpg'`);
      expect((await tayaCard())?.hasDetailPage).toBe(false);
      expect(await loadDetailSlugs()).toEqual([]);
      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
      await sql(`UPDATE media SET deleted_at = NULL WHERE pathname = '/assets/taya-hero.jpg'`);
      await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'taya-house'`);
      expect(await loadDetailSlugs()).toEqual([]);
      expect(await tayaCard()).toBeUndefined();
    });

    it('a highlight whose picture is in the trash is left out', async () => {
      const [first, ...rest] = (await loadRestaurantDetail('taya-house', 'en'))!.highlights;
      await sql(`UPDATE media SET deleted_at = now() WHERE url = $1`, [first.image.url]);
      expect((await loadRestaurantDetail('taya-house', 'en'))!.highlights.map((h) => h.title)).toEqual(rest.map((h) => h.title));
    });

    it('an uploaded menu PDF of the page’s language beats the default language’s link; one in the trash falls back to the link', async () => {
      const { rows } = await sql(
        `INSERT INTO media (storage, url, pathname, content_type, bytes) VALUES ('static', '/assets/test-l73-menu-vi.pdf', '/assets/test-l73-menu-vi.pdf', 'application/pdf', 1000) RETURNING id`,
      );
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, menu_pdf_media_id, status) VALUES ('taya-house', 'vi', $1, 'reviewed')`, [rows[0].id]);
      expect((await loadRestaurantDetail('taya-house', 'vi'))?.menu).toEqual({ kind: 'pdf', url: '/assets/test-l73-menu-vi.pdf' });
      await sql(`UPDATE media SET deleted_at = now() WHERE id = $1`, [rows[0].id]);
      expect((await loadRestaurantDetail('taya-house', 'vi'))?.menu).toEqual({ kind: 'pdf', url: DETAIL_PAGES_AT_8FE98F5['taya-house'].menuPdf });
    });

    it('the menu PDF of the page’s language, else the default language’s', async () => {
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, story, status) VALUES ('taya-house', 'vi', 'Câu chuyện.', 'reviewed')`);
      const vi = await loadRestaurantDetail('taya-house', 'vi');
      expect(vi).toMatchObject({ story: 'Câu chuyện.', kicker: DETAIL_PAGES_AT_8FE98F5['taya-house'].kicker });
      expect(vi?.menu).toEqual({ kind: 'pdf', url: DETAIL_PAGES_AT_8FE98F5['taya-house'].menuPdf });
      await sql(`UPDATE restaurant_i18n SET menu_pdf_url = 'https://furamavietnam.com/menu-vi.pdf' WHERE restaurant_id = 'taya-house' AND locale = 'vi'`);
      expect((await loadRestaurantDetail('taya-house', 'vi'))?.menu).toEqual({ kind: 'pdf', url: 'https://furamavietnam.com/menu-vi.pdf' });
    });
  });

  describe('languages (spec §5.1 item 5)', () => {
    it('a story or an experience translated in part keeps the default language’s other fields', async () => {
      await sql(`INSERT INTO experience_i18n (experience_id, locale, title, status) VALUES (1, 'vi', 'Trải nghiệm ẩm thực', 'reviewed')`);
      await sql(`INSERT INTO story_i18n (story_id, locale, category, status) VALUES (1, 'vi', 'Tin nhà hàng', 'reviewed')`);
      const [experience] = await loadExperiences('vi');
      expect(experience).toMatchObject({ title: 'Trải nghiệm ẩm thực', blurb: EXPERIENCES_AT_8FE98F5[0].blurb });
      const [story] = await loadStories('vi');
      // The date follows the language (phase 8 gives each its template); the title stays English.
      expect(story.kicker).toMatch(/^Tin nhà hàng · /);
      expect(story.title).toBe(STORIES_AT_8FE98F5[0].title);
    });

    it('shows a reviewed translation, and the default language for each field it lacks', async () => {
      await sql(`INSERT INTO destination_i18n (destination_id, locale, name, status) VALUES ('mm', 'vi', 'Furama MM Siêu thị', 'reviewed')`);
      const mm = (await loadDestinations('vi')).find((d) => d.id === 'mm');
      expect(mm).toMatchObject({ name: 'Furama MM Siêu thị', cardTitle: ['Furama MM', 'Supercenter'], cardBlurb: ['Everyday dining', 'for everyone'] });
      expect((await loadDestinations('en')).find((d) => d.id === 'mm')?.name).toBe('Furama MM Supercenter');
    });

    it('hides a machine translation until the language serves them', async () => {
      await sql(`INSERT INTO cuisine_i18n (cuisine_id, locale, label, status, origin) VALUES ('thai', 'vi', 'Món Thái', 'machine', 'ai')`);
      expect((await loadCuisines('vi')).find((c) => c.id === 'thai')?.label).toBe('Thai');
      await sql(`UPDATE locales SET serve_machine = true WHERE code = 'vi'`);
      expect((await loadCuisines('vi')).find((c) => c.id === 'thai')?.label).toBe('Món Thái');
    });

    it('translates alt text, and keeps a decorative image’s empty', async () => {
      await sql(
        `INSERT INTO media_i18n (media_id, locale, alt)
         SELECT id, 'vi', 'Đầu bếp Furama' FROM media WHERE pathname = '/assets/chef.jpg'
         UNION ALL SELECT id, 'vi', 'Di sản' FROM media WHERE pathname = '/assets/heritage.jpg'`,
      );
      const s = await loadSections('vi');
      expect(s.experiences.image?.alt).toBe('Đầu bếp Furama');
      expect(s.heritage.image?.alt).toBe('');
    });

    it('an uploaded picture brings its blur placeholder along (spec §6.3 item 7: CmsImage draws it)', async () => {
      const blur = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAoAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';
      try {
        await sql(`UPDATE media SET blur_data_url = $1 WHERE pathname = '/assets/chef.jpg'`, [blur]);
        expect((await loadSections('en')).experiences.image).toMatchObject({ url: SECTIONS_AT_8FE98F5.experiences.image, blur });
      } finally {
        await sql(`UPDATE media SET blur_data_url = NULL WHERE pathname = '/assets/chef.jpg'`);
      }
    });

    it('an offer translated in part keeps the default language’s other fields; its venue override beats the restaurant’s name', async () => {
      await sql(`INSERT INTO offer_i18n (offer_id, locale, title, status) VALUES (3, 'vi', 'Trà chiều và tiệc bánh ngọt', 'reviewed')`);
      await sql(`UPDATE offer_i18n SET venue_override = 'The Lounge, Furama Resort' WHERE offer_id = 3 AND locale = 'en'`);
      const tea = (await loadOffers('vi')).find((o) => o.id === 3);
      // vi formats the number its own way (phase 8 gives each language its template).
      expect(tea).toMatchObject({
        title: 'Trà chiều và tiệc bánh ngọt',
        venue: 'The Lounge, Furama Resort',
        detail: expect.stringMatching(/ · ~30 pastries, 12\+ teas$/),
      });
      expect((await loadOffers('en')).find((o) => o.id === 3)).toMatchObject({
        title: 'Afternoon Tea & Dessert Buffet',
        venue: 'The Lounge, Furama Resort',
      });
    });

    it('a language with no rows at all is the default language throughout', async () => {
      expect(await loadNav('zz')).toEqual(await loadNav('en'));
      expect(await loadDestinations('zz')).toEqual(await loadDestinations('en'));
      expect(await loadOffers('zz')).toEqual(await loadOffers('en'));
    });
  });

  describe('what the guest does not see', () => {
    it('an unpublished slide, experience or story', async () => {
      await sql(`UPDATE hero_slides SET is_published = false WHERE id = 2`);
      await sql(`UPDATE experiences SET is_published = false WHERE id = 2`);
      await sql(`UPDATE stories SET is_published = false WHERE id = 4`);
      expect((await loadHeroSlides('en')).map((h) => h.id)).toEqual([1, 3]);
      expect((await loadExperiences('en')).map((e) => e.id)).toEqual([1, 3]);
      expect((await loadStories('en')).map((s) => s.id)).toEqual([1, 2, 3]);
    });

    it('a slide whose picture was deleted, and the hero itself once every slide’s picture is', async () => {
      // Soft-deleted media: phase 7's media library deletes so (spec §5.2), and the slide has nothing to show.
      const pictures = (await sql(`SELECT h.image_id FROM hero_slides h ORDER BY h.id`)).rows.map((r) => r.image_id as string);
      try {
        await sql(`UPDATE media SET deleted_at = now() WHERE id = $1`, [pictures[0]]);
        expect((await loadHeroSlides('en')).map((h) => h.id)).toEqual([2, 3]);

        await sql(`UPDATE media SET deleted_at = now() WHERE id = ANY($1)`, [pictures]);
        const hero = await loadHeroSlides('en');
        expect(hero).toEqual([]);
        // The home page then has no hero (and marks itself so: ViewMarker, styles/layout.css).
        expect(homeSections(await loadSections('en'), { hero }).has('hero')).toBe(false);
      } finally {
        await sql(`UPDATE media SET deleted_at = NULL WHERE id = ANY($1)`, [pictures]);
      }
      expect((await loadHeroSlides('en')).map((h) => h.id)).toEqual([1, 2, 3]);
    });

    it('an unpublished cuisine, destination, nav item or social link', async () => {
      await sql(`UPDATE cuisines SET is_published = false WHERE id = 'hotpot'`);
      await sql(`UPDATE destinations SET is_published = false WHERE id = 'future'`);
      await sql(`UPDATE nav_items SET is_published = false WHERE target_section = 'stories'`);
      await sql(`UPDATE social_links SET is_published = false WHERE platform = 'tiktok'`);
      expect((await loadCuisines('en')).map((c) => c.id)).not.toContain('hotpot');
      expect((await loadDestinations('en')).map((d) => d.id)).toEqual(['resort', 'dining-house', 'mm']);
      expect((await loadNav('en')).map((n) => n.target)).not.toContain('stories');
      expect((await loadSocials('en')).map((s) => s.platform)).toEqual(['facebook', 'instagram', 'youtube']);
    });

    it('an unpublished offer, and the offers of a restaurant that is unpublished or archived', async () => {
      await sql(`UPDATE offers SET is_published = false WHERE id = 1`);
      expect((await loadOffers('en')).map((o) => o.id)).toEqual([2, 3]);
      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'taya-house'`);
      await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'hai-van-lounge'`);
      expect(await loadOffers('en')).toEqual([]);
    });

    it('a social link meant for other languages', async () => {
      await sql(`UPDATE social_links SET visible_locales = ARRAY['vi'] WHERE platform = 'youtube'`);
      expect((await loadSocials('en')).map((s) => s.platform)).not.toContain('youtube');
      expect((await loadSocials('vi')).map((s) => s.platform)).toContain('youtube');
    });

    it('a switched-off section sends no picture and no link: the layout hands every section to the browser', async () => {
      try {
        await sql(`UPDATE sections SET is_visible = false WHERE key = 'heritage'`);
        expect((await loadSections('en')).heritage).toEqual({ visible: false, image: null, link: null });
      } finally {
        await sql(`UPDATE sections SET is_visible = true WHERE key = 'heritage'`);
      }
      expect((await loadSections('en')).heritage).toMatchObject({
        visible: true,
        image: { url: SECTIONS_AT_8FE98F5.heritage.image },
        link: SECTIONS_AT_8FE98F5.heritage.link,
      });
    });

    it('a nav item whose section is switched off (spec §6.5)', async () => {
      await sql(`UPDATE sections SET is_visible = false WHERE key IN ('offers', 'stories')`);
      expect((await loadNav('en')).map((n) => n.target)).toEqual(['restaurants', 'destinations', 'experiences', 'heritage']);
      expect((await loadSections('en')).offers.visible).toBe(false);
    });
  });
});
