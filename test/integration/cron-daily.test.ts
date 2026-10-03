import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * /api/cron/daily (spec §6.2, §12): Vercel Cron's bearer secret or 401; with
 * it, content:offers is revalidated with 'max' (R7), so a database that is
 * down at 00:05 cannot turn the home page into an error. No database here.
 */

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag }));

const { GET, maxDuration } = await import('@/app/api/cron/daily/route');

const SECRET = 'cron-secret-0123456789abcdef';
const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: authorization ? { authorization } : {} }));

describe('GET /api/cron/daily', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    revalidateTag.mockReset();
  });

  it('answers 401 without the secret, with a wrong one, and when CRON_SECRET is unset or short; revalidates nothing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET, `bearer ${SECRET}`]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'short');
    expect((await call('Bearer short')).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('with the secret, revalidates content:offers once with the max profile (R7), never { expire: 0 }', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ revalidated: ['content:offers'] });
    expect(revalidateTag.mock.calls).toEqual([['content:offers', 'max']]);
  });

  it('is a short function: one call, no database', () => {
    expect(maxDuration).toBe(60);
  });
});
