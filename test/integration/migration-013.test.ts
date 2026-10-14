import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { imageSize, jpegIsRotated } from '@/lib/media/image-size';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 013: Furama's own photographs as static media rows. It only adds:
 * the seeded content still points at 008's files until the content pack
 * repoints it (content-pack.test.ts). After 013 every file of public/assets
 * has exactly one row, measured from the file; a re-run adds nothing; the
 * runbook's post-check (db/checks/postcheck-013.sql) passes.
 */

const url = databaseUrl('furama_cuisine_migrate013_test');
const FILE = 'db/migrations/013_official_photos.sql';
const ASSETS = join(process.cwd(), 'public', 'assets');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
/** A psql file of several statements: pg answers with one result per statement, or one result for one. */
const checks = async (file: string) => {
  const res = (await sql(readFileSync(file, 'utf8'))) as unknown;
  return (Array.isArray(res) ? res.flatMap((r) => r.rows) : (res as { rows: unknown[] }).rows) as { check: string; ok: boolean }[];
};

/** The files 013 adds: every file of public/assets that 008 did not seed. */
const ADDED = (FILE_TEXT: string) => [...FILE_TEXT.matchAll(/\('(\/assets\/[^']+)', 'image\//g)].map((m) => m[1]).sort();

describe.skipIf(!TEST_DATABASE_URL)('migration 013: the official photographs (database)', () => {
  let before: { pathname: string; id: string }[];

  beforeAll(async () => {
    resetDatabase(url, '012_ai_phase9.sql');
    before = (await sql(`SELECT pathname, id::text FROM media ORDER BY pathname`)).rows;
    migrate(url);
  });

  it('gives every file of public/assets exactly one row, measured from the file, and nothing else', async () => {
    const media = (
      await sql(`SELECT storage, url, pathname, content_type, width, height, bytes, blur_data_url, deleted_at FROM media ORDER BY pathname`)
    ).rows;
    const files = readdirSync(ASSETS).filter((f) => !f.startsWith('.')).sort();
    expect(media.map((m) => m.pathname)).toEqual(files.map((f) => `/assets/${f}`));
    for (const m of media) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'public', m.pathname)));
      const size = imageSize(bytes);
      expect({ path: m.pathname, storage: m.storage, url: m.url, type: m.content_type, w: m.width, h: m.height, bytes: m.bytes }).toEqual({
        path: m.pathname, storage: 'static', url: m.pathname, type: size?.contentType, w: size?.width, h: size?.height, bytes: bytes.length,
      });
      expect(jpegIsRotated(bytes)).toBe(false);
      expect(m.blur_data_url).toBeNull();
      expect(m.deleted_at).toBeNull();
    }
  });

  it('only adds: 008’s rows keep their ids, and nothing points at the new files yet', async () => {
    const added = ADDED(readFileSync(FILE, 'utf8'));
    expect(added).toHaveLength(37);
    const after = (await sql(`SELECT pathname, id::text FROM media WHERE NOT (pathname = ANY ($1::text[])) ORDER BY pathname`, [added])).rows;
    expect(after).toEqual(before);
    const { rows } = await sql(
      `SELECT m.pathname FROM media m
        WHERE m.pathname = ANY ($1::text[])
          AND (EXISTS (SELECT 1 FROM restaurants r WHERE m.id IN (r.card_image_id, r.detail_image_id, r.og_image_id))
            OR EXISTS (SELECT 1 FROM hero_slides s WHERE m.id IN (s.image_id, s.image_mobile_id))
            OR EXISTS (SELECT 1 FROM sections s WHERE s.image_id = m.id)
            OR EXISTS (SELECT 1 FROM destinations d WHERE d.card_image_id = m.id)
            OR EXISTS (SELECT 1 FROM cuisines c WHERE c.image_id = m.id)
            OR EXISTS (SELECT 1 FROM stories s WHERE s.image_id = m.id)
            OR EXISTS (SELECT 1 FROM restaurant_highlights h WHERE h.image_id = m.id))`,
      [added],
    );
    expect(rows).toEqual([]);
  });

  it('marks the chips, the destination and story cards, the heritage background and hero slides 2 and 3 decorative, and gives every other file English alt text', async () => {
    const added = ADDED(readFileSync(FILE, 'utf8'));
    const { rows } = await sql(
      `SELECT m.pathname, m.is_decorative, mi.alt, mi.origin, mi.status
         FROM media m LEFT JOIN media_i18n mi ON mi.media_id = m.id AND mi.locale = 'en'
        WHERE m.pathname = ANY ($1::text[]) ORDER BY m.pathname`,
      [added],
    );
    const decorative = rows.filter((r) => r.is_decorative).map((r) => r.pathname);
    expect(decorative).toEqual(
      added.filter(
        (p) =>
          /^\/assets\/(cuisine|dest|story)-/.test(p) ||
          ['/assets/heritage-resort-lobby-dusk.jpg', '/assets/hero-taya-house-dusk.jpg', '/assets/hero-cafe-indochine-show-kitchen.jpg'].includes(p),
      ),
    );
    expect(rows.filter((r) => r.is_decorative && r.alt !== null)).toEqual([]);
    expect(rows.filter((r) => !r.is_decorative).every((r) => r.alt && r.origin === 'seed' && r.status === 'reviewed')).toBe(true);
    // A restaurant card's alt is the restaurant's name (RestaurantCard.tsx, R19).
    const cards = Object.fromEntries(rows.filter((r) => r.pathname.startsWith('/assets/r-')).map((r) => [r.pathname, r.alt]));
    expect(cards['/assets/r-cafe-indochine-seafood-buffet.jpg']).toBe('Café Indochine');
    expect(cards['/assets/r-chaoshan-beef-hotpot-mm.jpg']).toBe('ChaoShan Hotpot');
  });

  it('re-runs without adding a row, and the runbook post-check passes', async () => {
    const count = async () => (await sql(`SELECT (SELECT count(*) FROM media)::int AS media, (SELECT count(*) FROM media_i18n)::int AS alts`)).rows[0];
    const once = await count();
    await sql(readFileSync(FILE, 'utf8'));
    expect(await count()).toEqual(once);
    expect((await checks('db/checks/postcheck-013.sql')).filter((r) => !r.ok)).toEqual([]);
  });
});
