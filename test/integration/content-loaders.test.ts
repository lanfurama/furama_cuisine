import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
import {
  CUISINES_AT_8FE98F5,
  DESTINATIONS_AT_8FE98F5,
  HERO_AUTOPLAY_MS_AT_8FE98F5,
  NAV_AT_8FE98F5,
  SECTIONS_AT_8FE98F5,
  SETTINGS_AT_8FE98F5,
  SOCIALS_AT_8FE98F5,
} from '../fixtures/phase5-content';

/*
 * The guest site's content loaders (lib/server/content/*.queries.ts) against
 * migration 008's seed. The expected values are the frozen content of phase 5
 * (test/fixtures/phase5-content.ts), so a loader that drifts from what the
 * site rendered fails here as well as in the visual baselines. Then the rules:
 * language fallback per field (spec §5.1 item 5), machine translations behind
 * serve_machine, unpublished rows, and nav items following their section.
 */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', () => {
  afterEach(async () => {
    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n']) await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
    await sql(`UPDATE locales SET serve_machine = false WHERE code = 'vi'`);
    await sql(`UPDATE sections SET is_visible = true`);
    await sql(`UPDATE cuisines SET is_published = true`);
    await sql(`UPDATE destinations SET is_published = true`);
    await sql(`UPDATE nav_items SET is_published = true`);
    await sql(`UPDATE social_links SET is_published = true, visible_locales = NULL`);
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
      // Printed as the site printed it; the Dining House now dials in E.164 (R18; the owner confirms the number, spec §15 item 14).
      expect(ds.filter((d) => d.showInFooter).map((d) => `${d.name} · ${d.address} · ${d.phone?.display}`)).toEqual(
        DESTINATIONS_AT_8FE98F5.flatMap((d) => (d.footer ? [d.footer] : [])),
      );
      expect(ds.filter((d) => d.showInFooter).map((d) => d.phone?.tel)).toEqual(['+842366519999', '+84859555759']);
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
    });
  });

  describe('languages (spec §5.1 item 5)', () => {
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

    it('a language with no rows at all is the default language throughout', async () => {
      expect(await loadNav('zz')).toEqual(await loadNav('en'));
      expect(await loadDestinations('zz')).toEqual(await loadDestinations('en'));
    });
  });

  describe('what the guest does not see', () => {
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

    it('a social link meant for other languages', async () => {
      await sql(`UPDATE social_links SET visible_locales = ARRAY['vi'] WHERE platform = 'youtube'`);
      expect((await loadSocials('en')).map((s) => s.platform)).not.toContain('youtube');
      expect((await loadSocials('vi')).map((s) => s.platform)).toContain('youtube');
    });

    it('a nav item whose section is switched off (spec §6.5)', async () => {
      await sql(`UPDATE sections SET is_visible = false WHERE key IN ('offers', 'stories')`);
      expect((await loadNav('en')).map((n) => n.target)).toEqual(['restaurants', 'destinations', 'experiences', 'heritage']);
      expect((await loadSections('en')).offers.visible).toBe(false);
    });
  });
});
