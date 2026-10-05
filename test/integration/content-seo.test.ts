import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { listHistory } from '@/lib/server/content-admin/history';
import { MEDIA_GONE } from '@/lib/server/content-admin/list-editor';
import { getSettingsEditor, restoreSettings, saveSettings, SHARE_IMAGE } from '@/lib/server/content-admin/settings';
import { loadRestaurantDetail } from '@/lib/server/content/restaurants.queries';
import { loadShareImage } from '@/lib/server/content/seo.queries';
import { mediaUsage } from '@/lib/server/media/library';

/*
 * The SEO screen's share picture (spec §5.2 site_settings.og_image_id, §7.2
 * content/seo) and a restaurant page's own (restaurants.og_image_id, L7-13)
 * against the database: the metadata loaders follow each save at once; the
 * picture must be live (code rule 2), comes out of the trash with a restore
 * (C7), and the library names the SEO screen as its user (AC3).
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };

const mediaId = async (pathname: string) => (await pool.query<{ id: string }>('SELECT id::text FROM media WHERE pathname = $1', [pathname])).rows[0].id;
const editor = () => getSettingsEditor(pool, SHARE_IMAGE);

describe.skipIf(!process.env.TEST_DATABASE_URL)('the share picture (database)', () => {
  beforeAll(async () => {
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
      ACTOR.id,
      ACTOR.name,
      ACTOR.email,
    ]);
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(async () => {
    await pool.query('UPDATE site_settings SET og_image_id = NULL');
    await pool.query(`UPDATE restaurants SET og_image_id = NULL WHERE id = 'taya-house'`);
    await pool.query(`UPDATE media SET deleted_at = NULL WHERE pathname = '/assets/hero-beach.jpg'`);
  });
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = $1`, [ACTOR.id]);
    await pool.end();
  });

  it('a chosen picture reaches every page’s metadata at once, with its alt; History puts “none” back', async () => {
    expect(await loadShareImage('en')).toBeNull();
    const beach = await mediaId('/assets/hero-beach.jpg');
    expect(await saveSettings(pool, ACTOR, SHARE_IMAGE, { token: (await editor()).token, values: { og_image_id: beach } })).toEqual(SAVED);
    expect(await loadShareImage('en')).toMatchObject({ url: '/assets/hero-beach.jpg', width: expect.any(Number), height: expect.any(Number) });
    expect(await mediaUsage(pool, beach)).toContainEqual(expect.objectContaining({ href: '/admin/content/seo' }));

    const [saved] = await listHistory(pool, 'site_settings', SHARE_IMAGE.id, 10);
    expect(await restoreSettings(pool, ACTOR, SHARE_IMAGE, { id: SHARE_IMAGE.id, auditId: saved.id, side: 'before', token: (await editor()).token })).toEqual({
      ok: true,
      data: null,
    });
    expect(await loadShareImage('en')).toBeNull();
  });

  it('a file in the trash cannot be chosen; a restore of a version that showed it takes it out of the trash (C7)', async () => {
    const beach = await mediaId('/assets/hero-beach.jpg');
    expect(await saveSettings(pool, ACTOR, SHARE_IMAGE, { token: (await editor()).token, values: { og_image_id: beach } })).toEqual(SAVED);
    const [saved] = await listHistory(pool, 'site_settings', SHARE_IMAGE.id, 10);
    expect(await saveSettings(pool, ACTOR, SHARE_IMAGE, { token: (await editor()).token, values: { og_image_id: null } })).toEqual(SAVED);
    await pool.query('UPDATE media SET deleted_at = now() WHERE id = $1', [beach]);

    expect(await saveSettings(pool, ACTOR, SHARE_IMAGE, { token: (await editor()).token, values: { og_image_id: beach } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { ogImageId: [MEDIA_GONE] },
    });
    expect(await restoreSettings(pool, ACTOR, SHARE_IMAGE, { id: SHARE_IMAGE.id, auditId: saved.id, side: 'after', token: (await editor()).token })).toEqual({
      ok: true,
      data: null,
    });
    expect((await pool.query('SELECT deleted_at FROM media WHERE id = $1', [beach])).rows[0].deleted_at).toBeNull();
    expect(await loadShareImage('en')).toMatchObject({ url: '/assets/hero-beach.jpg' });
  });

  it('a restaurant page reads its own share picture (L7-13); without one, null, so the page falls back to the SEO screen’s', async () => {
    expect((await loadRestaurantDetail('taya-house', 'en'))?.seo.image).toBeNull();
    await pool.query(`UPDATE restaurants SET og_image_id = (SELECT id FROM media WHERE pathname = '/assets/taya-garden.jpg') WHERE id = 'taya-house'`);
    expect((await loadRestaurantDetail('taya-house', 'en'))?.seo).toMatchObject({
      title: 'Tàya House — Furama Cuisine',
      image: { url: '/assets/taya-garden.jpg' },
    });
  });
});
