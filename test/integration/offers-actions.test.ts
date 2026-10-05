import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPool } from '@/db/client';
import { listOffersAdmin } from '@/lib/server/content-admin/offers';

/*
 * The offers list's switch as the Server Action receives it (7A fix-wave
 * residual): `publish` goes through PublishForm like every other list's
 * switch, so a forged value is refused, never read as "hide". The session is
 * mocked (the permission rule itself is the CI guard's and the E2E spec's);
 * updateTag is recorded.
 */

const updateTag = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ updateTag }));
vi.mock('@/lib/server/dal/session', () => ({
  PermissionError: class PermissionError extends Error {},
  requirePermission: vi.fn(async () => ({ userId: 'staff-b10', email: 'b10@furama.test', name: 'B10', role: 'editor', ip: null })),
  auditActor: (s: { userId: string; email: string; name: string }) => ({ id: s.userId, email: s.email, name: s.name, ip: null }),
}));

const { toggleOfferAction } = await import('@/app/admin/(shell)/content/offers/actions');

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('the offers switch action', () => {
  const pool = getPool();
  beforeEach(() => updateTag.mockClear());
  afterAll(async () => {
    await pool.query(`DELETE FROM audit_log WHERE actor_id = 'staff-b10'`);
    await pool.end();
  });

  it('refuses a publish value other than 0 or 1, writing nothing; 0 and 1 hide and show, and expire the offers', async () => {
    const offer = (await listOffersAdmin(pool)).items.find((o) => o.isPublished)!;
    expect(await toggleOfferAction(null, form({ id: offer.id, token: offer.token, publish: 'yes' }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateTag).not.toHaveBeenCalled();
    expect((await listOffersAdmin(pool)).items.find((o) => o.id === offer.id)).toMatchObject({ isPublished: true, token: offer.token });

    expect(await toggleOfferAction(null, form({ id: offer.id, token: offer.token, publish: '0' }))).toMatchObject({ ok: true });
    const hidden = (await listOffersAdmin(pool)).items.find((o) => o.id === offer.id)!;
    expect(hidden.isPublished).toBe(false);
    expect(updateTag).toHaveBeenCalled();
    expect(await toggleOfferAction(null, form({ id: offer.id, token: hidden.token, publish: '1' }))).toMatchObject({ ok: true });
    expect((await listOffersAdmin(pool)).items.find((o) => o.id === offer.id)!.isPublished).toBe(true);
  });
});
