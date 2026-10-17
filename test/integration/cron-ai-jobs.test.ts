import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/ai-jobs/route';
import { getPool, query } from '@/db/client';
import { TEST_DATABASE_URL } from '../helpers/db';

/* /api/cron/ai-jobs (spec §12, R9-2, R9-16): Vercel Cron's bearer secret or 401; with it, one SELECT when nothing waits, else a run. */

const SECRET = 'cron-secret-ai-0123456789abcdef';
const call = (authorization?: string) => GET(new Request('http://localhost/api/cron/ai-jobs', { headers: authorization ? { authorization } : {} }));

async function cleanUp() {
  await query('TRUNCATE ai_jobs, ai_usage CASCADE');
  for (const t of ['offer_i18n', 'cuisine_i18n', 'destination_i18n', 'experience_i18n', 'story_i18n', 'nav_item_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n', 'media_i18n']) {
    await query(`DELETE FROM ${t} WHERE locale = 'vi'`);
  }
  await query(`DELETE FROM content_strings WHERE locale = 'vi'`);
  await query(`DELETE FROM audit_log WHERE after->'meta' ? 'machine'`);
}

describe.skipIf(!TEST_DATABASE_URL)('GET /api/cron/ai-jobs (database)', () => {
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    await cleanUp();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await cleanUp();
    await getPool().end();
  });

  it('answers 401 without the secret, with a wrong one, and when CRON_SECRET is not set; runs nothing', async () => {
    await query(`INSERT INTO ai_jobs (locale) VALUES ('vi')`);
    vi.stubEnv('CRON_SECRET', SECRET);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect(await query(`SELECT status FROM ai_jobs`)).toEqual([{ status: 'queued' }]);
  });

  it('with the secret and nothing to run, answers at once; with a queued job, runs it to done', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const idle = await call(`Bearer ${SECRET}`);
    expect(idle.status).toBe(200);
    expect(await idle.json()).toEqual({ jobs: 0, docs: 0 });

    await query(`INSERT INTO ai_jobs (locale) VALUES ('vi')`);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ jobs: 1, docs: expect.any(Number) });
    expect(await query(`SELECT status FROM ai_jobs`)).toEqual([{ status: 'done' }]);
  });

  it('a run that cannot start answers 500 with a code only', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await query(`ALTER TABLE ai_jobs RENAME TO ai_jobs_gone`);
    try {
      const res = await call(`Bearer ${SECRET}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'run_failed' });
      expect(errors).toHaveBeenCalledWith('[cron:ai-jobs] run failed code=42P01');
    } finally {
      await query(`ALTER TABLE ai_jobs_gone RENAME TO ai_jobs`);
      errors.mockRestore();
    }
  });
});
