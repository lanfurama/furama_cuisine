import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditActor } from '@/lib/server/audit';
import { applyPackPeriods, loadPeriods, type PackPeriods } from '@/lib/server/booking/config';
import { applyContentPack, packErrors, type ContentPack, type PackChange } from '@/lib/server/content-admin/content-pack';
import { CUISINE } from '@/lib/server/content-admin/cuisines';
import { EXPERIENCE } from '@/lib/server/content-admin/experiences';
import { readRestaurant, restaurantValues, restoreRestaurant } from '@/lib/server/content-admin/restaurants';
import { readSection, restoreSection } from '@/lib/server/content-admin/sections';
import { restoreStory, STORY } from '@/lib/server/content-admin/stories';
import { readItem, snapshotToken } from '@/lib/server/history/snapshot';
import { databaseUrl, resetDatabase, TEST_DATABASE_URL } from '../helpers/db';

/*
 * applyContentPack (lib/server/content-admin/content-pack.ts) on a freshly
 * migrated database of its own, holding the seed of 002/008: a change applies
 * only while the value is still the seed's (a picture: the seeded file, or its
 * copy in Blob), never over a staff edit; the item's History gets one row,
 * before and after as its screen reads it, which its restore brings back; a
 * highlight is audited as its restaurant; a dry run changes nothing. And
 * scripts/apply-content-pack.mjs, run as the controller will run it.
 */

const run = promisify(execFile);
const ACTOR: AuditActor = { id: 'script:apply-content-pack', email: 'script:apply-content-pack' };
const STAFF: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };

let url: string;
let pool: Pool;

const pack = (...changes: PackChange[]): ContentPack => ({ id: 'test-pack', changes });
const apply = (p: ContentPack) => applyContentPack(pool, ACTOR, p, { dryRun: false });

type AuditRow = { id: string; action: string; actor_id: string | null; actor_email: string | null; before: unknown; after: unknown };
async function auditOf(entityType: string, entityId: string): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    'SELECT id::text, action, actor_id, actor_email, before, after FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY id',
    [entityType, entityId],
  );
  return rows;
}
const auditCount = async () => (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
const pictureOf = async (table: string, column: string, key: string, id: string) =>
  (await pool.query<{ pathname: string }>(`SELECT m.pathname FROM ${table} x JOIN media m ON m.id = x.${column} WHERE x.${key}::text = $1`, [id])).rows[0]?.pathname;

/** A file of the library, as migration 008 (static) or an upload / move-assets (blob) leaves it. */
async function addFile(pathname: string, options: { blob?: boolean; deleted?: boolean; pdf?: boolean } = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $5, 1000, $6) RETURNING id::text`,
    [
      options.blob ? 'blob' : 'static',
      options.blob ? `https://fakestore.public.blob.vercel-storage.com/${pathname}` : pathname,
      pathname,
      options.pdf ? 'application/pdf' : 'image/jpeg',
      options.pdf ? null : 100,
      options.deleted ? new Date() : null,
    ],
  );
  return rows[0].id;
}

describe('packErrors', () => {
  it('refuses an unknown list, a column a pack may not change, a picture into a column that holds no file, an id of the wrong type', () => {
    expect(packErrors(pack({ kind: 'row', entity: 'restaurants', id: 'danaksara', column: 'map_url', from: null, to: 'https://maps.app.goo.gl/x' }))).toEqual([]);
    expect(
      packErrors(
        pack(
          { kind: 'row', entity: 'reservations' as never, id: '1', column: 'status', from: 'pending', to: 'confirmed' },
          { kind: 'row', entity: 'stories', id: '1', column: 'href = NULL; --', from: null, to: null },
          { kind: 'image', entity: 'stories', id: '1', column: 'href', from: '/assets/a.jpg', to: '/assets/b.jpg' },
          { kind: 'row', entity: 'stories', id: '1', column: 'is_published', from: 'true', to: 'false' },
          { kind: 'text', entity: 'sections', id: 'heritage', column: 'title', from: null, to: 'x' },
          { kind: 'row', entity: 'stories', id: 'one', column: 'href', from: null, to: 'https://example.com/' },
          { kind: 'paint', entity: 'stories', id: '1', column: 'href', from: null, to: null } as never,
          { kind: 'row', entity: 'restaurants', id: 'danaksara', column: 'slug', from: 'danaksara', to: 'danaksara-restaurant' },
          { kind: 'row', entity: 'restaurants', id: 'danaksara', column: 'name', from: 'Danaksara', to: ' ' },
        ),
      ),
    ).toEqual([
      'change 1 (reservations 1 status): unknown list',
      'change 2 (stories 1 href = NULL; --): not a column a pack may change (row: href, published_on)',
      'change 3 (stories 1 href): a picture goes into an *_id column',
      'change 4 (stories 1 is_published): not a column a pack may change (row: href, published_on)',
      'change 5 (sections heritage title): this list has no translations',
      'change 6 (stories one href): the id must be text of digits',
      'change 7 (stories 1 href): unknown kind',
      'change 8 (restaurants danaksara slug): not a column a pack may change (row: name, phone_e164, phone_display, map_url)',
      'change 9 (restaurants danaksara name): a restaurant\'s name is text of 1 to 60 characters',
    ]);
    expect(packErrors({ id: '', changes: [] })).toEqual(['a pack needs an id and a list of changes']);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('content packs (own database)', () => {
  beforeAll(async () => {
    url = databaseUrl('furama_cuisine_contentpack_test');
    resetDatabase(url);
    pool = new Pool({ connectionString: url, max: 4 });
    await addFile('/assets/pack-card.jpg');
    await addFile('/assets/pack-class.jpg');
    await addFile('/assets/pack-chef.jpg');
    await addFile('/assets/pack-trashed.jpg', { deleted: true });
    await addFile('/assets/pack-menu.pdf', { pdf: true });
    // A file added after the move to Blob, moved too (production/assets/…).
    await addFile('production/assets/pack-moved.jpg', { blob: true });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('refuses an invalid pack whole, before it reads anything', async () => {
    const audits = await auditCount();
    await expect(apply(pack({ kind: 'image', entity: 'cuisines', id: 'thai', column: 'label', from: '/assets/cuisine-thai.jpg', to: '/assets/pack-card.jpg' }))).rejects.toThrow(
      'content pack test-pack: change 1 (cuisines thai label): a picture goes into an *_id column',
    );
    expect(await auditCount()).toBe(audits);
  });

  it('repoints a picture while it shows the seeded file; skips it once staff (or the pack) changed it, a same-named upload included', async () => {
    const before = await readRestaurant(pool, 'danaksara');
    const change = { kind: 'image', entity: 'restaurants', id: 'danaksara', column: 'card_image_id', from: '/assets/r-danaksara.jpg', to: '/assets/pack-card.jpg' } as const;
    expect(await apply(pack(change))).toEqual([{ change, applied: true }]);
    expect(await pictureOf('restaurants', 'card_image_id', 'id', 'danaksara')).toBe('/assets/pack-card.jpg');
    // One History row, the restaurant on either side as its screen reads it, by this script (History names it by actor_email).
    expect(await auditOf('restaurants', 'danaksara')).toEqual([
      {
        id: expect.any(String),
        action: 'update',
        actor_id: 'script:apply-content-pack',
        actor_email: 'script:apply-content-pack',
        before,
        after: await readRestaurant(pool, 'danaksara'),
      },
    ]);

    // Run again: no longer the seed's file.
    expect(await apply(pack(change))).toEqual([
      { change, applied: false, reason: 'the picture is no longer /assets/r-danaksara.jpg (now /assets/pack-card.jpg)' },
    ]);
    // Staff uploaded a new card under the seeded file's name: an upload, not the seed's file.
    const upload = await addFile('development/media/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/r-the-fan.jpg', { blob: true });
    await pool.query('UPDATE restaurants SET card_image_id = $2 WHERE id = $1', ['the-fan', upload]);
    const fan = { ...change, id: 'the-fan', from: '/assets/r-the-fan.jpg' };
    expect(await apply(pack(fan))).toEqual([
      { change: fan, applied: false, reason: 'the picture is no longer /assets/r-the-fan.jpg (now development/media/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/r-the-fan.jpg)' },
    ]);
    expect(await auditOf('restaurants', 'the-fan')).toEqual([]);
  });

  it('a seeded file moved to Blob (production/assets/<same name>) is still the seed’s, and `to` finds a moved file too', async () => {
    await pool.query(
      `UPDATE media SET storage = 'blob', pathname = 'production' || pathname, url = 'https://fakestore.public.blob.vercel-storage.com/production' || pathname
        WHERE pathname = '/assets/r-hura-izakaya.jpg'`,
    );
    const change = { kind: 'image', entity: 'restaurants', id: 'hura-izakaya', column: 'card_image_id', from: '/assets/r-hura-izakaya.jpg', to: '/assets/pack-moved.jpg' } as const;
    expect(await apply(pack(change))).toEqual([{ change, applied: true }]);
    expect(await pictureOf('restaurants', 'card_image_id', 'id', 'hura-izakaya')).toBe('production/assets/pack-moved.jpg');
  });

  it('skips a `to` that is not a live picture (missing, in the trash, a PDF) and an item that is gone', async () => {
    const changes: PackChange[] = ['/assets/pack-nowhere.jpg', '/assets/pack-trashed.jpg', '/assets/pack-menu.pdf'].map((to) => ({
      kind: 'image',
      entity: 'cuisines',
      id: 'thai',
      column: 'image_id',
      from: '/assets/cuisine-thai.jpg',
      to,
    }));
    const gone: PackChange[] = [
      { kind: 'image', entity: 'restaurants', id: 'nowhere', column: 'card_image_id', from: '/assets/r-nowhere.jpg', to: '/assets/pack-card.jpg' },
      { kind: 'image', entity: 'restaurant_highlights', id: '999', column: 'image_id', from: '/assets/taya-class.jpg', to: '/assets/pack-card.jpg' },
    ];
    const audits = await auditCount();
    expect((await apply(pack(...changes, ...gone))).map((o) => o.reason)).toEqual([
      '/assets/pack-nowhere.jpg is not a live picture of the library (apply migration 013 first)',
      '/assets/pack-trashed.jpg is not a live picture of the library (apply migration 013 first)',
      '/assets/pack-menu.pdf is not a live picture of the library (apply migration 013 first)',
      'not found',
      'not found',
    ]);
    expect(await pictureOf('cuisines', 'image_id', 'id', 'thai')).toBe('/assets/cuisine-thai.jpg');
    expect(await auditCount()).toBe(audits);
  });

  it('changes an English text only while it is the seed’s (origin seed, value `from`), and leaves it a seed row', async () => {
    const type = { kind: 'text', entity: 'restaurants', id: 'chaoshan-hotpot', column: 'type_label', from: 'Chinese Hotpot', to: 'Chinese Hotpot · MM' } as const;
    expect(await apply(pack(type))).toEqual([{ change: type, applied: true }]);
    const { rows } = await pool.query(`SELECT type_label, origin, status, updated_by FROM restaurant_i18n WHERE restaurant_id = 'chaoshan-hotpot' AND locale = 'en'`);
    expect(rows).toEqual([{ type_label: 'Chinese Hotpot · MM', origin: 'seed', status: 'reviewed', updated_by: 'script:apply-content-pack' }]);

    // Edited in the admin (origin human), even back to the seed's words: never overwritten.
    await pool.query(`UPDATE cuisine_i18n SET origin = 'human' WHERE cuisine_id = 'thai' AND locale = 'en'`);
    const edited = { kind: 'text', entity: 'cuisines', id: 'thai', column: 'label', from: 'Thai', to: 'Thai Cuisine' } as const;
    // Still a seed row, but not the words the pack expects.
    const other = { kind: 'text', entity: 'cuisines', id: 'italian', column: 'label', from: 'Italiano', to: 'Italian Cuisine' } as const;
    expect(await apply(pack(edited, other))).toEqual([
      { change: edited, applied: false, reason: 'its English was edited in the admin' },
      { change: other, applied: false, reason: "the text is no longer the seed's (now Italian)" },
    ]);
    expect(await auditOf('cuisines', 'thai')).toEqual([]);
    expect(await auditOf('cuisines', 'italian')).toEqual([]);
  });

  it('changes a row’s column (a link, a date): one History row per item, which the list’s restore undoes', async () => {
    const seeded = await readItem(pool, STORY, '2');
    const undated = await readItem(pool, STORY, '4');
    const href = { kind: 'row', entity: 'stories', id: '2', column: 'href', from: String(seeded!.row.href), to: 'https://furamavietnam.com/stories/the-fan/' } as const;
    const date = { kind: 'row', entity: 'stories', id: '4', column: 'published_on', from: null, to: '2026-08-30' } as const;
    // Already the seed's 9 Sep: skipped.
    const stale = { kind: 'row', entity: 'stories', id: '1', column: 'published_on', from: '2026-01-01', to: '2026-09-10' } as const;
    expect(await apply(pack(href, date, stale))).toEqual([
      { change: href, applied: true },
      { change: date, applied: true },
      { change: stale, applied: false, reason: "the value is no longer the seed's (now 2026-09-09)" },
    ]);
    const [two] = await auditOf('stories', '2');
    expect(two).toMatchObject({ action: 'update', before: seeded, after: await readItem(pool, STORY, '2') });
    expect((await auditOf('stories', '4')).map((r) => [r.before, r.after])).toEqual([[undated, await readItem(pool, STORY, '4')]]);
    expect(await auditOf('stories', '1')).toEqual([]);

    // "Khôi phục bản trước lần này": the seeded link comes back.
    expect(await restoreStory(pool, STAFF, { id: '2', auditId: two.id, side: 'before', token: snapshotToken(await readItem(pool, STORY, '2')) })).toEqual({
      ok: true,
      data: null,
    });
    expect((await readItem(pool, STORY, '2'))!.row.href).toBe(seeded!.row.href);
  });

  it('a highlight changes as part of its restaurant: one History row under the restaurant, which its restore undoes', async () => {
    const before = await readRestaurant(pool, 'taya-house');
    const changes: PackChange[] = [
      { kind: 'image', entity: 'restaurant_highlights', id: '1', column: 'image_id', from: '/assets/taya-class.jpg', to: '/assets/pack-class.jpg' },
      { kind: 'text', entity: 'restaurant_highlights', id: '2', column: 'title', from: 'Healthy Drinks & Snacks', to: 'Healthy Drinks & Garden Snacks' },
      { kind: 'text', entity: 'restaurants', id: 'taya-house', column: 'seo_title', from: 'Tàya House — Furama Cuisine', to: 'Tàya House, a wellness dining home — Furama Cuisine' },
    ];
    expect((await apply(pack(...changes))).every((o) => o.applied)).toBe(true);
    const after = await readRestaurant(pool, 'taya-house');
    expect(after!.highlights.map((h) => h.i18n.find((t) => t.locale === 'en')?.title)).toContain('Healthy Drinks & Garden Snacks');
    const rows = await auditOf('restaurants', 'taya-house');
    expect(rows).toEqual([expect.objectContaining({ action: 'update', before, after })]);
    expect((await pool.query(`SELECT 1 FROM audit_log WHERE entity_type = 'restaurant_highlights'`)).rowCount).toBe(0);

    expect(
      await restoreRestaurant(pool, STAFF, { id: 'taya-house', auditId: rows[0].id, side: 'before', token: snapshotToken(await readRestaurant(pool, 'taya-house')) }),
    ).toMatchObject({ ok: true });
    // As the form shows it (the token cannot match: a restore stamps every highlight, and the highlights stay whole in it).
    expect(restaurantValues((await readRestaurant(pool, 'taya-house'))!)).toEqual(restaurantValues(before!));
    expect(await pictureOf('restaurant_highlights', 'image_id', 'id', '1')).toBe('/assets/taya-class.jpg');
  });

  it('a section: its picture and its link, one History row each, which restoreSection undoes', async () => {
    const experiences = await readSection(pool, 'experiences');
    const heritage = await readSection(pool, 'heritage');
    const picture = { kind: 'image', entity: 'sections', id: 'experiences', column: 'image_id', from: '/assets/chef.jpg', to: '/assets/pack-chef.jpg' } as const;
    const link = { kind: 'row', entity: 'sections', id: 'heritage', column: 'link_url', from: 'https://furamavietnam.com/the-resort/', to: 'https://furamavietnam.com/heritage/' } as const;
    expect(await apply(pack(picture, link))).toEqual([
      { change: picture, applied: true },
      { change: link, applied: true },
    ]);
    const [row] = await auditOf('sections', 'experiences');
    expect(row).toMatchObject({ before: experiences, after: await readSection(pool, 'experiences') });
    expect(await auditOf('sections', 'heritage')).toEqual([expect.objectContaining({ before: heritage, after: await readSection(pool, 'heritage') })]);

    expect(await restoreSection(pool, STAFF, { id: 'experiences', auditId: row.id, side: 'before', token: snapshotToken(await readSection(pool, 'experiences')) })).toEqual({
      ok: true,
      data: null,
    });
    expect(await pictureOf('sections', 'image_id', 'key', 'experiences')).toBe('/assets/chef.jpg');
  });

  it('renames a restaurant, and its card’s alt follows while it was the old name (R19), audited as the file', async () => {
    const card = (await pool.query<{ id: string }>(`SELECT card_image_id::text AS id FROM restaurants WHERE id = 'chaoshan-hotpot'`)).rows[0].id;
    const rename = { kind: 'row', entity: 'restaurants', id: 'chaoshan-hotpot', column: 'name', from: 'ChaoShan Hotpot', to: 'Chao Shan Beef Hotpot' } as const;
    const earlier = (await auditOf('restaurants', 'chaoshan-hotpot')).length;
    expect(await apply(pack(rename))).toEqual([{ change: rename, applied: true }]);
    expect((await pool.query(`SELECT name FROM restaurants WHERE id = 'chaoshan-hotpot'`)).rows[0]).toEqual({ name: 'Chao Shan Beef Hotpot' });
    expect((await pool.query(`SELECT alt FROM media_i18n WHERE media_id = $1 AND locale = 'en'`, [card])).rows[0]).toEqual({ alt: 'Chao Shan Beef Hotpot' });
    expect(await auditOf('media', card)).toEqual([expect.objectContaining({ action: 'update', actor_email: ACTOR.email })]);
    expect(await auditOf('restaurants', 'chaoshan-hotpot')).toHaveLength(earlier + 1);

    // An alt written by hand stays.
    await pool.query(`UPDATE media_i18n SET alt = 'Hotpot at MM Supercenter' WHERE media_id = $1 AND locale = 'en'`, [card]);
    const back = { ...rename, from: 'Chao Shan Beef Hotpot', to: 'ChaoShan Hotpot' } as const;
    expect(await apply(pack(back))).toEqual([{ change: back, applied: true }]);
    expect((await pool.query(`SELECT alt FROM media_i18n WHERE media_id = $1 AND locale = 'en'`, [card])).rows[0]).toEqual({ alt: 'Hotpot at MM Supercenter' });
  });

  it('takes an optional picture away (a destination card), never a required one', async () => {
    const off = { kind: 'image', entity: 'destinations', id: 'future', column: 'card_image_id', from: '/assets/dest-future.jpg', to: null } as const;
    expect(packErrors(pack({ ...off, entity: 'hero_slides', id: '2', column: 'image_id', from: '/assets/hero-taya.jpg' }))).toEqual([
      'change 1 (hero_slides 2 image_id): this picture cannot be taken away',
    ]);
    expect(await apply(pack(off))).toEqual([{ change: off, applied: true }]);
    expect(await pictureOf('destinations', 'card_image_id', 'id', 'future')).toBeUndefined();
    // Gone now, so a second run finds no seeded file and skips.
    expect(await apply(pack(off))).toEqual([{ change: off, applied: false, reason: 'the picture is no longer /assets/dest-future.jpg (now none)' }]);
  });

  it('booking periods: a restaurant’s whole list, replaced only while it is the seed’s, with one service_periods History row', async () => {
    const ALL = [1, 2, 3, 4, 5, 6, 7];
    const period = (meal: 'Breakfast' | 'Lunch' | 'Dinner', firstSeating: string, lastSeating: string, weekdays = ALL) =>
      ({ meal, weekdays, firstSeating, lastSeating, intervalMin: 30, coversPerSlot: 26, active: true }) as const;
    const seed = [period('Breakfast', '06:30', '09:30'), period('Lunch', '11:30', '13:30'), period('Dinner', '18:00', '21:00')];
    const weekdaysOnly = seed.map((p) => ({ ...p, weekdays: [1, 2, 3, 4, 5] }));
    const entry: PackPeriods = { restaurant: 'v-senses-cafe', from: seed.map((p) => ({ ...p })), to: weekdaysOnly };
    const before = await loadPeriods(pool, 'v-senses-cafe');

    const dry = await applyPackPeriods(pool, ACTOR, [entry], { dryRun: true });
    expect(dry).toEqual([{ restaurant: 'v-senses-cafe', applied: true }]);
    expect(await loadPeriods(pool, 'v-senses-cafe')).toEqual(before);

    expect(await applyPackPeriods(pool, ACTOR, [entry], { dryRun: false })).toEqual(dry);
    const after = await loadPeriods(pool, 'v-senses-cafe');
    expect(after.map((p) => p.weekdays)).toEqual([[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]);
    expect(await auditOf('service_periods', 'v-senses-cafe')).toEqual([expect.objectContaining({ action: 'update', before, after })]);

    // Not the seed's any more (this run's own change included): skipped, nothing written.
    expect(await applyPackPeriods(pool, ACTOR, [entry], { dryRun: false })).toEqual([
      { restaurant: 'v-senses-cafe', applied: false, reason: 'its periods are no longer the seed’s' },
    ]);
    // Overlapping periods are refused as the editor refuses them.
    const clash = { ...entry, from: weekdaysOnly, to: [period('Lunch', '11:30', '13:30'), period('Dinner', '13:00', '14:00')] };
    expect((await applyPackPeriods(pool, ACTOR, [clash], { dryRun: false }))[0]).toMatchObject({ applied: false, reason: expect.stringMatching(/^the new periods overlap/) });
    expect(await loadPeriods(pool, 'v-senses-cafe')).toEqual(after);
  });

  it('a dry run says what an apply would do, and changes nothing: no row, no audit row', async () => {
    const changes: PackChange[] = [
      { kind: 'image', entity: 'cuisines', id: 'vietnamese', column: 'image_id', from: '/assets/cuisine-vietnamese.jpg', to: '/assets/pack-card.jpg' },
      { kind: 'text', entity: 'experiences', id: '1', column: 'title', from: 'Culinary Experiences', to: 'Culinary Journeys' },
      { kind: 'row', entity: 'experiences', id: '3', column: 'link_url', from: null, to: 'https://furamavietnam.com/fabulous/' },
    ];
    const items = async () => [await readItem(pool, CUISINE, 'vietnamese'), await readItem(pool, EXPERIENCE, '1'), await readItem(pool, EXPERIENCE, '3')];
    const before = await items();
    const audits = await auditCount();
    const said = await applyContentPack(pool, ACTOR, pack(...changes), { dryRun: true });
    expect(said.map((o) => o.applied)).toEqual([true, true, true]);
    expect(await items()).toEqual(before);
    expect(await auditCount()).toBe(audits);

    expect(await apply(pack(...changes))).toEqual(said);
    expect(await auditCount()).toBe(audits + 3);
  });

  it('scripts/apply-content-pack.mjs: a dry run prints the target, each change and its outcome, and changes nothing; an invalid pack exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'content-pack-'));
    // A clean environment: only what pg needs to find the local server, and the test database.
    const script = (file: string, ...args: string[]) =>
      run(process.execPath, [join(process.cwd(), 'scripts/apply-content-pack.mjs'), file, ...args], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, DATABASE_URL: url, NODE_ENV: 'test' },
      });
    try {
      const file = join(dir, 'pack.json');
      writeFileSync(
        file,
        JSON.stringify(
          pack(
            { kind: 'image', entity: 'cuisines', id: 'japanese', column: 'image_id', from: '/assets/cuisine-japanese.jpg', to: '/assets/pack-card.jpg' },
            { kind: 'text', entity: 'cuisines', id: 'japanese', column: 'label', from: 'Nihon', to: 'Japanese Cuisine' },
          ),
        ),
      );
      const before = await readItem(pool, CUISINE, 'japanese');
      const audits = await auditCount();
      const { stdout } = await script(file);
      expect(stdout.split('\n')).toEqual([
        `DRY RUN: database localhost${new URL(url).pathname}`,
        'Pack test-pack: 2 change(s).',
        '  applied cuisines japanese image_id: "/assets/cuisine-japanese.jpg" → "/assets/pack-card.jpg"',
        `  skipped cuisines japanese en.label: "Nihon" → "Japanese Cuisine" (the text is no longer the seed's (now Japanese))`,
        '1 applied, 1 skipped.',
        'Dry run: nothing changed. Add --apply to write the changes.',
        '',
      ]);
      expect(await readItem(pool, CUISINE, 'japanese')).toEqual(before);
      expect(await auditCount()).toBe(audits);

      writeFileSync(file, JSON.stringify(pack({ kind: 'image', entity: 'cuisines', id: 'japanese', column: 'label', from: 'a', to: 'b' })));
      await expect(script(file, '--apply')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('a picture goes into an *_id column') });
      expect(await auditCount()).toBe(audits);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
