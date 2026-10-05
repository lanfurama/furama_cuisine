import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { listDeleted } from '@/lib/server/content-admin/history';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import {
  createSocialLink,
  deleteSocialLink,
  listSocialLinksAdmin,
  reorderSocialLinks,
  restoreSocialLink,
  restoreSocialLinkOrder,
  setSocialLinkPublished,
  SOCIAL_HREF_INVALID,
  SOCIAL_LINK,
  SOCIAL_PLATFORM_INVALID,
  updateSocialLink,
} from '@/lib/server/content-admin/socials';
import { loadSocials } from '@/lib/server/content/site.queries';

/*
 * The footer's social links (spec §7.2 content/contact, §6.5 "Social links
 * tối đa 6") against the database: the footer's links (loadSocials) follow
 * each write at once.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };

let seed: ItemSnapshot[] = [];

const audit = async () => (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const link = async (platform: string) => (await listSocialLinksAdmin(pool)).items.find((s) => s.values.platform === platform)!;
const listToken = async () => (await listSocialLinksAdmin(pool)).token;
const footer = async (locale = 'en') => (await loadSocials(locale)).map((s) => `${s.platform}:${s.href}`);

/** Puts the links back as migration 008 seeded them. */
async function resetSocials() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM social_links');
    for (const s of seed) await writeItem(client, SOCIAL_LINK, s, 'seed', { order: true });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('social links editor (database)', () => {
  beforeAll(async () => {
    seed = await readItems(pool, SOCIAL_LINK);
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetSocials());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('an edited link reaches the footer at once; History brings the old address back; a page older than another save is a conflict', async () => {
    expect(await footer()).toEqual([
      'facebook:https://www.facebook.com/furamaresort',
      'instagram:https://www.instagram.com/furamaculinaryworld/',
      'youtube:https://www.youtube.com/user/furamaresortvietnam',
      'tiktok:https://www.tiktok.com/@furama.dining.hous',
    ]);
    const facebook = await link('facebook');
    expect(await updateSocialLink(pool, ACTOR, facebook.id, facebook.token, { ...facebook.values, href: 'https://www.facebook.com/furamacuisine' })).toEqual({
      ok: true,
      data: null,
    });
    expect(await footer()).toContain('facebook:https://www.facebook.com/furamacuisine');
    const [saved] = await audit();
    expect(saved).toMatchObject({ action: 'update', entity_type: 'social_links', entity_id: facebook.id });
    expect(await updateSocialLink(pool, OTHER, facebook.id, facebook.token, facebook.values)).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
    expect(await restoreSocialLink(pool, OTHER, { id: facebook.id, auditId: saved.id, side: 'before', token: (await link('facebook')).token })).toEqual({
      ok: true,
      data: null,
    });
    expect(await footer()).toContain('facebook:https://www.facebook.com/furamaresort');
  });

  it('a link names a platform migration 008 allows and an https address; at most 6 show (spec §6.5)', async () => {
    const facebook = await link('facebook');
    expect(await updateSocialLink(pool, ACTOR, facebook.id, facebook.token, { ...facebook.values, href: 'http://www.facebook.com/furamaresort' })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { href: [SOCIAL_HREF_INVALID] },
    });
    expect(
      await updateSocialLink(pool, ACTOR, facebook.id, facebook.token, { ...facebook.values, platform: 'myspace' as unknown as typeof facebook.values.platform }),
    ).toEqual({ ok: false, code: 'invalid', fieldErrors: { platform: [SOCIAL_PLATFORM_INVALID] } });

    // Four shown: two more may show, a seventh only hidden, and its switch is refused.
    for (const platform of ['zalo', 'tripadvisor'] as const) {
      expect((await createSocialLink(pool, ACTOR, { platform, href: `https://${platform}.example/furama`, isPublished: true })).ok).toBe(true);
    }
    expect(await createSocialLink(pool, ACTOR, { platform: 'line', href: 'https://line.example/furama', isPublished: true })).toEqual({
      ok: false,
      code: 'limit',
      params: { max: '6' },
    });
    expect((await createSocialLink(pool, ACTOR, { platform: 'line', href: 'https://line.example/furama', isPublished: false })).ok).toBe(true);
    const line = await link('line');
    expect(await setSocialLinkPublished(pool, ACTOR, line.id, line.token, true)).toEqual({ ok: false, code: 'limit', params: { max: '6' } });
    expect(await footer()).toHaveLength(6);
  });

  it('the languages a link shows in (phase 8) survive a save, and come back with a deleted link, under its id in its place', async () => {
    const youtube = await link('youtube');
    await pool.query(`UPDATE social_links SET visible_locales = '{en}' WHERE id = $1`, [youtube.id]);
    const before = (await listSocialLinksAdmin(pool)).items.map((s) => s.id);
    const fresh = await link('youtube');
    expect(await updateSocialLink(pool, ACTOR, fresh.id, fresh.token, { ...fresh.values, href: 'https://www.youtube.com/@furama' })).toEqual({ ok: true, data: null });
    expect((await pool.query('SELECT visible_locales FROM social_links WHERE id = $1', [youtube.id])).rows[0]).toEqual({ visible_locales: ['en'] });
    expect(await footer('vi')).not.toContain('youtube:https://www.youtube.com/@furama');

    expect(await deleteSocialLink(pool, ACTOR, youtube.id, (await link('youtube')).token)).toEqual({ ok: true, data: { meta: null } });
    expect(await footer()).not.toContain('youtube:https://www.youtube.com/@furama');
    const [gone] = await listDeleted(pool, SOCIAL_LINK);
    expect(await restoreSocialLink(pool, OTHER, { id: gone.id, auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
    expect((await listSocialLinksAdmin(pool)).items.map((s) => s.id)).toEqual(before);
    expect((await pool.query('SELECT visible_locales, href FROM social_links WHERE id = $1', [youtube.id])).rows[0]).toEqual({
      visible_locales: ['en'],
      href: 'https://www.youtube.com/@furama',
    });
  });

  it('a new order reaches the footer, and the order’s History puts the old one back', async () => {
    const before = (await listSocialLinksAdmin(pool)).items.map((s) => s.id);
    expect(await reorderSocialLinks(pool, ACTOR, await listToken(), [...before].reverse())).toEqual({ ok: true, data: null });
    expect((await footer())[0]).toMatch(/^tiktok:/);
    const reordered = (await audit()).at(-1);
    expect(reordered).toMatchObject({ action: 'reorder', entity_type: 'social_links', entity_id: null });
    expect(await restoreSocialLinkOrder(pool, OTHER, { auditId: reordered.id, side: 'before', token: await listToken() })).toEqual({ ok: true, data: null });
    expect((await listSocialLinksAdmin(pool)).items.map((s) => s.id)).toEqual(before);
  });
});
