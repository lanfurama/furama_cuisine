import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import {
  createExperience,
  deleteExperience,
  EXPERIENCE,
  listExperiencesAdmin,
  reorderExperiences,
  restoreExperience,
  restoreExperienceOrder,
  updateExperience,
  type ExperienceInput,
} from '@/lib/server/content-admin/experiences';
import { listDeleted } from '@/lib/server/content-admin/history';
import { MEDIA_GONE, NEEDS_EN_TITLE } from '@/lib/server/content-admin/list-editor';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import {
  createStory,
  deleteStory,
  listStoriesAdmin,
  restoreStory,
  setStoryPublished,
  STORY,
  updateStory,
  type StoryInput,
} from '@/lib/server/content-admin/stories';
import { loadExperiences, loadStories } from '@/lib/server/content/home.queries';

/*
 * The Experiences and Stories list editors (spec §7.2 content/experiences
 * and content/stories, §6.5 "Experiences 1–5", "Stories tối đa 4", §7.4,
 * §7.5) against the database. The home page's loaders are read after each
 * step; a story's kicker joins only the parts that exist (L7-7).
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };

let seedExperiences: ItemSnapshot[] = [];
let seedStories: ItemSnapshot[] = [];

const audit = async () => (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const experience = async (id: string) => (await listExperiencesAdmin(pool)).items.find((e) => e.id === id)!;
const story = async (id: string) => (await listStoriesAdmin(pool)).items.find((s) => s.id === id)!;

const row = (title: string, patch: Partial<ExperienceInput> = {}): ExperienceInput => ({
  link: null,
  isPublished: true,
  title: { en: title },
  blurb: { en: null },
  ...patch,
});

/** Puts both lists back as migration 008 seeded them, and removes this test's own rows. */
async function resetLists() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM experiences');
    for (const s of seedExperiences) await writeItem(client, EXPERIENCE, s, 'seed', { order: true });
    await client.query('DELETE FROM stories');
    for (const s of seedStories) await writeItem(client, STORY, s, 'seed', { order: true });
    await client.query(`DELETE FROM media WHERE pathname LIKE '/assets/test-b3-%'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('experiences and stories editors (database)', () => {
  beforeAll(async () => {
    seedExperiences = await readItems(pool, EXPERIENCE);
    seedStories = await readItems(pool, STORY);
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetLists());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  describe('experiences', () => {
    it('a row’s title and link reach the home page at once; History brings the old ones back; a page older than another save is a conflict', async () => {
      const e = await experience('2');
      expect(e.values).toEqual({ link: null, isPublished: true, title: { en: 'Private Dining & Events' }, blurb: { en: 'Weddings · Corporate · Celebrations · MICE dining' } });
      const link = 'https://furamavietnam.com/meetings-events/';
      expect(await updateExperience(pool, ACTOR, '2', e.token, { ...e.values, link, title: { en: 'Private Dining & Weddings' } })).toEqual(SAVED);
      expect((await loadExperiences('en'))[1]).toMatchObject({ id: 2, title: 'Private Dining & Weddings', href: link });
      const [saved] = await audit();
      expect(saved).toMatchObject({ action: 'update', entity_type: 'experiences', entity_id: '2' });
      expect(await updateExperience(pool, OTHER, '2', e.token, e.values)).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
      expect(await restoreExperience(pool, OTHER, { id: '2', auditId: saved.id, side: 'before', token: (await experience('2')).token })).toEqual({ ok: true, data: null });
      expect((await loadExperiences('en'))[1]).toMatchObject({ title: 'Private Dining & Events', href: null });
    });

    it('needs its EN title (save and restore); at most 5 shown; deleted, it comes back under its id in its place; the order and its History', async () => {
      expect(await createExperience(pool, ACTOR, row('Untitled', { title: { en: null } }))).toEqual({ ok: false, code: 'invalid', fieldErrors: { title: [NEEDS_EN_TITLE] } });
      for (const t of ['Four', 'Five']) expect((await createExperience(pool, ACTOR, row(t))).ok).toBe(true);
      expect(await createExperience(pool, ACTOR, row('Six'))).toEqual({ ok: false, code: 'limit', params: { max: '5' } });
      expect(await createExperience(pool, ACTOR, row('Six', { isPublished: false }))).toMatchObject({ ok: true });

      const ids = (await listExperiencesAdmin(pool)).items.map((x) => x.id);
      expect(await reorderExperiences(pool, ACTOR, (await listExperiencesAdmin(pool)).token, [...ids].reverse())).toEqual({ ok: true, data: null });
      const reordered = (await audit()).at(-1);
      expect(await deleteExperience(pool, ACTOR, '1', (await experience('1')).token)).toEqual({ ok: true, data: { meta: null } });
      const [gone] = await listDeleted(pool, EXPERIENCE);
      expect(await restoreExperience(pool, OTHER, { id: '1', auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
      expect((await listExperiencesAdmin(pool)).items.map((x) => x.id)).toEqual([...ids].reverse());
      expect(await restoreExperienceOrder(pool, OTHER, { auditId: reordered.id, side: 'before', token: (await listExperiencesAdmin(pool)).token })).toEqual({
        ok: true,
        data: null,
      });
      expect((await listExperiencesAdmin(pool)).items.map((x) => x.id)).toEqual(ids);

      // A stored version without its EN title cannot come back (code rule 5).
      const blank = await pool.query<{ id: string }>(
        `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after)
         VALUES ('staff-lan', 'lan@furama.test', 'update', 'experiences', '3', $1::jsonb, NULL) RETURNING id::text`,
        [JSON.stringify({ v: 1, row: { ...seedExperiences[2].row }, i18n: [] })],
      );
      expect(await restoreExperience(pool, ACTOR, { id: '3', auditId: blank.rows[0].id, side: 'before', token: (await experience('3')).token })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { title: [NEEDS_EN_TITLE] },
      });
    });
  });

  describe('stories', () => {
    it('a card without a category shows its date alone, with no leading separator (L7-7); History puts the category back', async () => {
      expect((await loadStories('en'))[0].kicker).toBe('Restaurant News · 9 Sep 2026');
      const s = await story('1');
      expect(await updateStory(pool, ACTOR, '1', s.token, { ...s.values, category: { en: null } })).toEqual(SAVED);
      expect((await loadStories('en'))[0].kicker).toBe('9 Sep 2026');
      const [saved] = await audit();
      expect(await restoreStory(pool, OTHER, { id: '1', auditId: saved.id, side: 'before', token: (await story('1')).token })).toEqual({ ok: true, data: null });
      expect((await loadStories('en'))[0].kicker).toBe('Restaurant News · 9 Sep 2026');
    });

    it('a translated card without a link of its own takes the English one, then the card’s (L8-1)', async () => {
      const english = (await pool.query(`SELECT href FROM story_i18n WHERE story_id = 1 AND locale = 'en'`)).rows[0]?.href ?? null;
      try {
        await pool.query(`UPDATE story_i18n SET href = 'https://example.com/en-article' WHERE story_id = 1 AND locale = 'en'`);
        await pool.query(`INSERT INTO story_i18n (story_id, locale, title) VALUES (1, 'vi', 'Chuyện từ bếp')`);
        const [card] = await loadStories('vi');
        expect(card).toMatchObject({ title: 'Chuyện từ bếp', href: 'https://example.com/en-article' });
      } finally {
        await pool.query(`DELETE FROM story_i18n WHERE locale = 'vi'`);
        await pool.query(`UPDATE story_i18n SET href = $1 WHERE story_id = 1 AND locale = 'en'`, [english]);
      }
    });

    it('at most 4 shown; a hidden draft is allowed; the picture must be live; deleted, a card comes back under its id', async () => {
      const draft: StoryInput = {
        imageId: String(seedStories[0].row.image_id),
        href: 'https://www.furamadining.com/diem-den/tin/',
        publishedOn: '2026-10-01',
        isPublished: true,
        category: { en: 'Restaurant News' },
        title: { en: 'A fifth story' },
        localHref: { en: null },
      };
      expect(await createStory(pool, ACTOR, draft)).toEqual({ ok: false, code: 'limit', params: { max: '4' } });
      const created = await createStory(pool, ACTOR, { ...draft, isPublished: false });
      expect(created.ok).toBe(true);
      const id = created.ok ? created.data.id : '';
      expect(await setStoryPublished(pool, ACTOR, id, (await story(id)).token, true)).toEqual({ ok: false, code: 'limit', params: { max: '4' } });

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, deleted_at)
         VALUES ('static', '/assets/test-b3-gone.jpg', '/assets/test-b3-gone.jpg', 'image/jpeg', 40, 30, 1000, now()) RETURNING id`,
      );
      expect(await updateStory(pool, ACTOR, id, (await story(id)).token, { ...draft, isPublished: false, imageId: rows[0].id })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { imageId: [MEDIA_GONE] },
      });

      expect(await deleteStory(pool, ACTOR, '4', (await story('4')).token)).toEqual({ ok: true, data: { meta: null } });
      expect((await loadStories('en')).map((x) => x.id)).toEqual([1, 2, 3]);
      const [gone] = await listDeleted(pool, STORY);
      expect(await restoreStory(pool, OTHER, { id: '4', auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
      expect((await loadStories('en')).map((x) => [x.id, x.kicker])).toEqual([
        [1, 'Restaurant News · 9 Sep 2026'],
        [2, 'Restaurant News · 5 Sep 2026'],
        [3, 'Restaurant News · 3 Sep 2026'],
        [4, 'Furama Resort Danang'],
      ]);
    });
  });
});
