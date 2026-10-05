import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { FIRST_SLIDE_NEEDS_CROP } from '@/lib/admin/content-rules';
import { homeSections } from '@/lib/content/home-sections';
import type { AuditActor } from '@/lib/server/audit';
import {
  createSlide,
  deleteSlide,
  HERO_SLIDE,
  listSlidesAdmin,
  reorderSlides,
  restoreSlide,
  restoreSlideOrder,
  setSlidePublished,
  updateSlide,
} from '@/lib/server/content-admin/hero';
import { listDeleted } from '@/lib/server/content-admin/history';
import { MEDIA_GONE } from '@/lib/server/content-admin/list-editor';
import { getAutoplayEditor, listSectionsAdmin, restoreAutoplay, restoreSection, saveAutoplay, saveSection } from '@/lib/server/content-admin/sections';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadHeroSlides } from '@/lib/server/content/home.queries';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadSections } from '@/lib/server/content/site.queries';
import { getSharedInbox, saveSharedInbox } from '@/lib/server/email/recipients';

/*
 * The sections and hero editors (spec §7.2 content/sections and content/hero,
 * §6.5, §7.4, §7.5) against the database: a section's switch, picture and
 * link under the hash token, with History; the film's link names a video;
 * restaurants never hides; the hero's slides as a makeListEditor list with
 * the "first slide shown has its phone crop" rule on every write; the slide
 * pace. The guest loaders are read after each step: what the home page draws
 * (homeSections) follows at once.
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };
const YOUTUBE = 'https://youtu.be/dQw4w9WgXcQ';

let seedSections: Record<string, unknown>[] = [];
let seedSlides: ItemSnapshot[] = [];
let seedAutoplay = 0;
let seedInbox = '';

const audit = async () =>
  (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const section = async (key: string) => (await listSectionsAdmin(pool)).find((s) => s.key === key)!;
const slideToken = async (id: string) => (await listSlidesAdmin(pool)).items.find((s) => s.id === id)!.token;
const listToken = async () => (await listSlidesAdmin(pool)).token;
const shownSlides = async () => (await loadHeroSlides('en')).map((s) => s.id);
const mediaId = async (pathname: string) => (await pool.query<{ id: string }>('SELECT id FROM media WHERE pathname = $1', [pathname])).rows[0].id;

/** A library file of this test's own, unused by anything: a picture, or a PDF with no size. */
async function testFile(name: string, type: 'image/jpeg' | 'application/pdf' = 'image/jpeg'): Promise<string> {
  const pdf = type === 'application/pdf';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes) VALUES ('static', $1, $1, $2, $3, $4, 1000) RETURNING id`,
    [`/assets/test-a9-${name}.${pdf ? 'pdf' : 'jpg'}`, type, pdf ? null : 40, pdf ? null : 30],
  );
  return rows[0].id;
}

/** Puts the sections, the slides, the pace and the inbox back as migration 008 seeded them. */
async function resetHero() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE sections s SET is_visible = r.is_visible, image_id = r.image_id, link_url = r.link_url
         FROM jsonb_populate_recordset(NULL::sections, $1::jsonb) r WHERE s.key = r.key`,
      [JSON.stringify(seedSections)],
    );
    await client.query('DELETE FROM hero_slides');
    for (const s of seedSlides) await writeItem(client, HERO_SLIDE, s, 'seed');
    await client.query('UPDATE site_settings SET hero_autoplay_ms = $1, email = $2 WHERE id', [seedAutoplay, seedInbox]);
    await client.query(`DELETE FROM media WHERE pathname LIKE '/assets/test-a9-%'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('sections and hero editors (database)', () => {
  beforeAll(async () => {
    seedSections = (await pool.query<{ s: Record<string, unknown> }>('SELECT to_jsonb(s) AS s FROM sections s')).rows.map((r) => r.s);
    seedSlides = await readItems(pool, HERO_SLIDE);
    seedAutoplay = (await getAutoplayEditor(pool)).ms;
    seedInbox = (await getSharedInbox(pool)).email;
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetHero());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  describe('sections', () => {
    it('hiding the hero takes it off the home page; History brings it back; a page older than another save is a conflict', async () => {
      expect(homeSections(await loadSections('en')).has('hero')).toBe(true);
      const seen = (await section('hero')).token;
      const answer = await saveSection(pool, ACTOR, { key: 'hero', token: seen, isVisible: false });
      expect(answer).toEqual({ ok: true, data: { token: (await section('hero')).token } });
      expect((await loadSections('en')).hero.visible).toBe(false);
      expect(homeSections(await loadSections('en')).has('hero')).toBe(false);

      const [hidden] = await audit();
      expect(hidden).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'sections', entity_id: 'hero' });
      expect(hidden.before).toMatchObject({ v: 1, row: { key: 'hero', is_visible: true }, i18n: [] });
      expect(hidden.after).toMatchObject({ row: { key: 'hero', is_visible: false } });

      // The page loaded before that save: a conflict naming who saved first, and nothing written.
      expect(await saveSection(pool, OTHER, { key: 'hero', token: seen, isVisible: true })).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
      expect(await audit()).toHaveLength(1);

      expect(await restoreSection(pool, OTHER, { id: 'hero', auditId: hidden.id, side: 'before', token: (await section('hero')).token })).toEqual({ ok: true, data: null });
      expect(homeSections(await loadSections('en')).has('hero')).toBe(true);
      expect((await audit()).at(-1)).toMatchObject({ action: 'restore', entity_id: 'hero', after: { row: { is_visible: true }, meta: { restored_from: hidden.id } } });
    });

    it('restaurants never hides; the film plays one YouTube or Vimeo video; a part the form does not post keeps its value', async () => {
      expect(await saveSection(pool, ACTOR, { key: 'restaurants', token: (await section('restaurants')).token, isVisible: false })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { isVisible: [expect.stringMatching(/luôn hiện/)] },
      });
      const film = await section('film');
      expect(await saveSection(pool, ACTOR, { key: 'film', token: film.token, isVisible: true, link: 'https://www.youtube.com/@furama' })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { link: [expect.stringMatching(/YouTube hoặc Vimeo/)] },
      });
      expect(await audit()).toEqual([]);

      expect(await saveSection(pool, ACTOR, { key: 'film', token: film.token, isVisible: true, imageId: film.imageId, link: YOUTUBE })).toEqual(SAVED);
      expect((await loadSections('en')).film).toMatchObject({ visible: true, link: YOUTUBE, image: { url: '/assets/hero-beach.jpg' } });
      // The film switched off: the link stays in the row, and never travels to the browser (loadSections).
      expect(await saveSection(pool, ACTOR, { key: 'film', token: (await section('film')).token, isVisible: false })).toEqual(SAVED);
      expect(await section('film')).toMatchObject({ visible: false, link: YOUTUBE, imageId: film.imageId });
      expect((await loadSections('en')).film).toEqual({ visible: false, image: null, link: null });
    });

    it('a picture must be live (code rule 2); a version whose picture is in the trash brings it back; a purged one cannot come back (C7)', async () => {
      const heritage = await section('heritage');
      const picture = await testFile('heritage');
      expect(await saveSection(pool, ACTOR, { key: 'heritage', token: heritage.token, isVisible: true, imageId: picture })).toEqual(SAVED);
      const [withPicture] = await audit();
      expect((await loadSections('en')).heritage.image?.url).toBe('/assets/test-a9-heritage.jpg');
      expect(
        await saveSection(pool, ACTOR, { key: 'heritage', token: (await section('heritage')).token, isVisible: true, imageId: heritage.imageId }),
      ).toEqual(SAVED);

      // Nothing uses it now: the library may put it in the trash, and no save may point at it then.
      await pool.query('UPDATE media SET deleted_at = now() WHERE id = $1', [picture]);
      expect(await saveSection(pool, ACTOR, { key: 'heritage', token: (await section('heritage')).token, isVisible: true, imageId: picture })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { imageId: [MEDIA_GONE] },
      });
      // History: the version with that picture takes it out of the trash, in the same transaction.
      expect(await restoreSection(pool, ACTOR, { id: 'heritage', auditId: withPicture.id, side: 'after', token: (await section('heritage')).token })).toEqual({
        ok: true,
        data: null,
      });
      expect((await pool.query('SELECT deleted_at FROM media WHERE id = $1', [picture])).rows[0].deleted_at).toBeNull();
      expect((await audit()).map((a) => `${a.action} ${a.entity_type}`).slice(-2)).toEqual(['restore media', 'restore sections']);

      // Once the sweep purged it, that version cannot come back.
      await saveSection(pool, ACTOR, { key: 'heritage', token: (await section('heritage')).token, isVisible: true, imageId: heritage.imageId });
      await pool.query('DELETE FROM media WHERE id = $1', [picture]);
      expect(await restoreSection(pool, ACTOR, { id: 'heritage', auditId: withPicture.id, side: 'after', token: (await section('heritage')).token })).toEqual({
        ok: false,
        code: 'missing_reference',
      });
      expect((await loadSections('en')).heritage.image?.url).toBe('/assets/heritage.jpg');
    });
  });

  describe('hero slides', () => {
    it('spec §6.5: at most 5 slides shown; hidden ones do not count', async () => {
      const taya = await mediaId('/assets/hero-taya.jpg');
      expect(await createSlide(pool, ACTOR, { imageId: taya, imageMobileId: null, isPublished: true })).toMatchObject({ ok: true });
      expect(await createSlide(pool, ACTOR, { imageId: taya, imageMobileId: null, isPublished: true })).toMatchObject({ ok: true });
      expect(await createSlide(pool, ACTOR, { imageId: taya, imageMobileId: null, isPublished: true })).toEqual({ ok: false, code: 'limit', params: { max: '5' } });
      expect(await createSlide(pool, ACTOR, { imageId: taya, imageMobileId: null, isPublished: false })).toMatchObject({ ok: true });
      expect(await shownSlides()).toHaveLength(5);
    });

    it('two slides on one picture are named apart by their place, so their buttons are too (7A review A9)', async () => {
      const taya = await mediaId('/assets/hero-taya.jpg');
      expect(await createSlide(pool, ACTOR, { imageId: taya, imageMobileId: null, isPublished: false })).toMatchObject({ ok: true });
      const items = (await listSlidesAdmin(pool)).items;
      const names = items.map((i) => i.name);
      expect(new Set(names).size).toBe(names.length);
      const shared = items.flatMap((item, i) => (item.imageId === taya ? [[item.name, i + 1] as const] : []));
      expect(shared).toHaveLength(2);
      for (const [name, place] of shared) expect(name).toBe(`hero-taya.jpg (slide ${place})`);
      expect(names.filter((n) => !n.includes('(slide '))).toHaveLength(names.length - 2);
    });

    it('a slide takes pictures only: a PDF of the library is refused in either picture, and nothing is written', async () => {
      const menu = await testFile('menu', 'application/pdf');
      const taya = await mediaId('/assets/hero-taya.jpg');
      expect(await createSlide(pool, ACTOR, { imageId: menu, imageMobileId: null, isPublished: false })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { imageId: [MEDIA_GONE] },
      });
      expect(await updateSlide(pool, ACTOR, '1', await slideToken('1'), { imageId: taya, imageMobileId: menu, isPublished: true })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { imageMobileId: [MEDIA_GONE] },
      });
      expect(await audit()).toEqual([]);
      expect(await shownSlides()).toEqual([1, 2, 3]);
    });

    it('the first slide shown needs its phone crop, whichever write would change it; a refused write leaves nothing behind', async () => {
      const refused = { ok: false, code: 'invalid', fieldErrors: { imageMobileId: [FIRST_SLIDE_NEEDS_CROP] } };
      // Hiding slide 1, deleting it or moving slide 2 first would put a slide with no crop on phones.
      expect(await setSlidePublished(pool, ACTOR, '1', await slideToken('1'), false)).toEqual(refused);
      expect(await deleteSlide(pool, ACTOR, '1', await slideToken('1'))).toEqual(refused);
      expect(await reorderSlides(pool, ACTOR, await listToken(), ['2', '1', '3'])).toEqual(refused);
      const beach = await mediaId('/assets/hero-beach.jpg');
      expect(await updateSlide(pool, ACTOR, '1', await slideToken('1'), { imageId: beach, imageMobileId: null, isPublished: true })).toEqual(refused);
      expect(await audit()).toEqual([]);
      expect(await shownSlides()).toEqual([1, 2, 3]);

      // With no slide shown there is no first slide: the home page drops its hero (homeSections).
      for (const id of ['2', '3', '1']) expect(await setSlidePublished(pool, ACTOR, id, await slideToken(id), false)).toEqual({ ok: true, data: null });
      expect(await shownSlides()).toEqual([]);
      expect(homeSections(await loadSections('en'), { hero: await loadHeroSlides('en') }).has('hero')).toBe(false);

      // A crop on slide 2 lets it lead.
      const crop = await mediaId('/assets/hero-hall-m.jpg');
      const taya = await mediaId('/assets/hero-taya.jpg');
      expect(await updateSlide(pool, ACTOR, '2', await slideToken('2'), { imageId: taya, imageMobileId: crop, isPublished: true })).toEqual(SAVED);
      expect(await shownSlides()).toEqual([2]);
    });

    it('a deleted slide comes back under its id with its pictures; the old order comes back', async () => {
      expect(await deleteSlide(pool, ACTOR, '3', await slideToken('3'))).toEqual({ ok: true, data: { meta: null } });
      expect(await shownSlides()).toEqual([1, 2]);
      const [deleted] = await listDeleted(pool, HERO_SLIDE);
      expect(deleted).toMatchObject({ id: '3', before: { row: { id: 3 } } });
      expect(await restoreSlide(pool, ACTOR, { id: '3', auditId: deleted.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
      expect((await loadHeroSlides('en')).map((s) => [s.id, s.image.url])).toEqual([
        [1, '/assets/hero-beach.jpg'],
        [2, '/assets/hero-taya.jpg'],
        [3, '/assets/hero-indochine.jpg'],
      ]);

      expect(await reorderSlides(pool, ACTOR, await listToken(), ['1', '3', '2'])).toEqual({ ok: true, data: null });
      expect(await shownSlides()).toEqual([1, 3, 2]);
      const reorder = (await audit()).at(-1)!;
      expect(reorder).toMatchObject({ action: 'reorder', entity_type: 'hero_slides', entity_id: null });
      expect(await restoreSlideOrder(pool, ACTOR, { auditId: reorder.id, side: 'before', token: await listToken() })).toEqual({ ok: true, data: null });
      expect(await shownSlides()).toEqual([1, 2, 3]);
    });
  });

  it('the slide pace: saved in milliseconds, History puts it back; the shared inbox’s save in between is not a conflict', async () => {
    const seen = await getAutoplayEditor(pool);
    expect(seen.ms).toBe(7000);
    const inbox = await getSharedInbox(pool);
    expect(await saveSharedInbox(pool, OTHER, { email: 'events@furama.test', token: inbox.token })).toEqual({ ok: true, data: null });
    const paced = await saveAutoplay(pool, ACTOR, { token: seen.token, ms: 9000 });
    expect(paced).toEqual({ ok: true, data: { token: (await getAutoplayEditor(pool)).token } });
    expect((await loadSiteSettings(pool))!.heroAutoplayMs).toBe(9000);
    expect(await saveAutoplay(pool, OTHER, { token: seen.token, ms: 5000 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveAutoplay(pool, ACTOR, { token: (await getAutoplayEditor(pool)).token, ms: 2000 })).toMatchObject({ ok: false, code: 'invalid' });

    const saved = (await audit()).find((a) => a.entity_id === 'hero_autoplay_ms')!;
    expect(saved).toMatchObject({ action: 'update', entity_type: 'site_settings', before: { row: { hero_autoplay_ms: 7000 } }, after: { row: { hero_autoplay_ms: 9000 } } });
    expect(
      await restoreAutoplay(pool, OTHER, { id: 'hero_autoplay_ms', auditId: saved.id, side: 'before', token: (await getAutoplayEditor(pool)).token }),
    ).toEqual({ ok: true, data: null });
    expect((await loadSiteSettings(pool))!.heroAutoplayMs).toBe(7000);
    expect((await loadSiteSettings(pool))!.email).toBe('events@furama.test');
  });

  it('the slide pace leaves site_settings.updated_at alone: the shared inbox’s page token survives a pace save', async () => {
    const inbox = await getSharedInbox(pool);
    expect(await saveAutoplay(pool, ACTOR, { token: (await getAutoplayEditor(pool)).token, ms: 9000 })).toEqual(SAVED);
    expect(await saveSharedInbox(pool, OTHER, { email: 'events@furama.test', token: inbox.token })).toEqual({ ok: true, data: null });
    expect((await loadSiteSettings(pool))!).toMatchObject({ heroAutoplayMs: 9000, email: 'events@furama.test' });
  });

  it('a stale pace save names who saved the pace (its History), not who saved the inbox since', async () => {
    const seen = await getAutoplayEditor(pool);
    expect(await saveAutoplay(pool, ACTOR, { token: seen.token, ms: 9000 })).toEqual(SAVED);
    expect(await saveSharedInbox(pool, OTHER, { email: 'events@furama.test', token: (await getSharedInbox(pool)).token })).toEqual({ ok: true, data: null });
    expect(await saveAutoplay(pool, OTHER, { token: seen.token, ms: 5000 })).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
  });
});
