import { APICallError, NoObjectGeneratedError } from 'ai';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { TEST_DATABASE_URL } from '@/test/helpers/db';
import { ceilingUsd, monthSpendUsd, reserveAiCall, runAiCall, type AiCallMeta } from './guard';

const STAFF = 'staff-guard';
const OTHER = 'staff-guard-2';
const settings: AiSettings = { ...AiSettingsSchema.parse({}), budgetUsd: 1, limits: { perMinute: 3, perDay: 5 } };
const ok = async () => ({ value: 'x', usage: { inputTokens: 1000, outputTokens: 1000 } });
const meta = (o: Partial<AiCallMeta> = {}): AiCallMeta => ({
  feature: 'translate',
  model: 'gemini-3.8-flash',
  region: 'global',
  actorId: STAFF,
  inputChars: 300,
  maxOutputTokens: 1000,
  ...o,
});
const passed = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled').length;
let pool: Pool;

// Advisory locks serialise the parallel calls, and a loaded machine can push a test past the default 5 s.
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!TEST_DATABASE_URL)('AI guard (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 12 });
  });
  afterAll(async () => {
    await pool.query('TRUNCATE ai_usage');
    await pool.query(`DELETE FROM staff_user WHERE id IN ($1, $2)`, [STAFF, OTHER]);
    await pool.end();
  });
  beforeEach(async () => {
    // Other files TRUNCATE staff_user ... CASCADE, which empties ai_usage; seed what this file needs.
    await pool.query('TRUNCATE ai_usage');
    for (const id of [STAFF, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`, [id]);
    }
  });

  it('settles the real cost', async () => {
    await runAiCall(pool, settings, meta(), ok);
    const { rows } = await pool.query(`SELECT status, input_tokens, output_tokens, cost_usd::float AS c FROM ai_usage`);
    expect(rows).toEqual([{ status: 'ok', input_tokens: 1000, output_tokens: 1000, c: expect.closeTo(0.009, 6) }]);
  });

  it('blocks the fourth call in a minute, counting only that person', async () => {
    for (let i = 0; i < 3; i++) await runAiCall(pool, settings, meta(), ok);
    await expect(runAiCall(pool, settings, meta(), ok)).rejects.toMatchObject({ code: 'ai_rate_minute', params: { limit: 3 } });
    await runAiCall(pool, settings, meta({ actorId: null }), ok); // a job is not a person
    await runAiCall(pool, settings, meta({ actorId: OTHER }), ok); // another person has their own count
  });

  it('never blocks a connection check, but spends the budget on it', async () => {
    for (let i = 0; i < 3; i++) await runAiCall(pool, settings, meta(), ok);
    await runAiCall(pool, settings, meta({ feature: 'check', actorId: null }), ok);
    await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', 0.995)`);
    await expect(runAiCall(pool, settings, meta({ feature: 'check', actorId: null }), ok)).rejects.toMatchObject({ code: 'ai_budget' });
  });

  // Rows pinned to the Vietnam day start, with a minute limit nobody reaches: independent of the clock near midnight.
  const dayStart = `date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
  const daySettings: AiSettings = { ...settings, limits: { perMinute: 100, perDay: 5 } };

  it('blocks per day from 00:00 Vietnam time', async () => {
    await pool.query(
      `INSERT INTO ai_usage (at, actor_id, feature, model, region, status) SELECT ${dayStart}, $1, 'translate', 'gemini-3.8-flash', 'global', 'ok' FROM generate_series(1,5)`,
      [STAFF],
    );
    await expect(runAiCall(pool, daySettings, meta(), ok)).rejects.toMatchObject({ code: 'ai_rate_day', params: { limit: 5 } });
  });

  it('does not count yesterday (Vietnam time) towards today', async () => {
    await pool.query(
      `INSERT INTO ai_usage (at, actor_id, feature, model, region, status)
       SELECT ${dayStart} - interval '1 minute', $1, 'translate', 'gemini-3.8-flash', 'global', 'ok' FROM generate_series(1,5)`,
      [STAFF],
    );
    await runAiCall(pool, daySettings, meta(), ok);
  });

  it('blocks when the month plus the ceiling would pass the budget, for every caller', async () => {
    await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', 0.995)`);
    await expect(runAiCall(pool, settings, meta({ actorId: null }), ok)).rejects.toMatchObject({ code: 'ai_budget' });
    expect((await pool.query('SELECT 1 FROM ai_usage')).rowCount).toBe(1);
  });

  it('concurrent calls: exactly the limit passes', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => runAiCall(pool, settings, meta(), ok)));
    expect(passed(results)).toBe(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'ai_rate_minute')).toBe(true);
  });

  it('concurrent calls: exactly one passes on the last of the budget', async () => {
    const c = ceilingUsd(meta({ actorId: null }));
    // Room for 1.5 ceilings: one fits, a second does not.
    await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', $1)`, [settings.budgetUsd - c * 1.5]);
    const two = await Promise.allSettled([runAiCall(pool, settings, meta({ actorId: null }), ok), runAiCall(pool, settings, meta({ actorId: null }), ok)]);
    expect(passed(two)).toBe(1);
  });

  it('counts a pending row at its ceiling', async () => {
    const before = (await monthSpendUsd(pool)).spent;
    const r = await reserveAiCall(pool, settings, meta());
    const { rows } = await pool.query(`SELECT status, cost_usd::float AS c FROM ai_usage WHERE actor_id = $1`, [STAFF]);
    expect(rows).toEqual([{ status: 'pending', c: expect.closeTo(ceilingUsd(meta()), 6) }]);
    expect((await monthSpendUsd(pool)).spent - before).toBeCloseTo(ceilingUsd(meta()), 6);
    await r.settle({});
  });

  it('settles an error at zero and maps its code', async () => {
    await expect(
      runAiCall(pool, settings, meta(), async () => {
        throw new APICallError({ message: 'q', url: 'u', requestBodyValues: {}, statusCode: 429 });
      }),
    ).rejects.toMatchObject({ code: 'ai_quota' });
    const { rows } = await pool.query(`SELECT status, error_code, cost_usd::float AS c FROM ai_usage`);
    expect(rows).toEqual([{ status: 'error', error_code: 'ai_quota', c: 0 }]);
  });

  it('refuses an already aborted signal without a row', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runAiCall(pool, settings, meta({ signal: ac.signal }), ok)).rejects.toMatchObject({ code: 'ai_failed' });
    expect((await pool.query('SELECT 1 FROM ai_usage')).rowCount).toBe(0);
  });

  describe('reserveAiCall', () => {
    it('charges the tokens a NoObjectGeneratedError carries, as an error', async () => {
      const err = new NoObjectGeneratedError({ message: 'n', response: { id: 'i', timestamp: new Date(), modelId: 'm' }, usage: { inputTokens: 1000, outputTokens: 100 } as never, finishReason: 'stop' });
      await expect(runAiCall(pool, settings, meta(), async () => { throw err; })).rejects.toMatchObject({ code: 'ai_failed' });
      const { rows } = await pool.query(`SELECT status, input_tokens, output_tokens, cost_usd::float AS c FROM ai_usage`);
      expect(rows).toEqual([{ status: 'error', input_tokens: 1000, output_tokens: 100, c: expect.closeTo(0.00225, 6) }]);
    });

    it('a late settle cannot overwrite a fail, nor the reverse', async () => {
      const a = await reserveAiCall(pool, settings, meta());
      await a.fail(new Error('x'));
      await a.settle({ inputTokens: 1000, outputTokens: 1000 });
      expect((await pool.query(`SELECT status FROM ai_usage`)).rows).toEqual([{ status: 'error' }]);
      await pool.query('TRUNCATE ai_usage');
      const b = await reserveAiCall(pool, settings, meta());
      await b.settle({ inputTokens: 1000, outputTokens: 1000 });
      await b.fail(new Error('x'));
      expect((await pool.query(`SELECT status, error_code FROM ai_usage`)).rows).toEqual([{ status: 'ok', error_code: null }]);
    });

    it('settle with no token counts keeps the ceiling', async () => {
      const r = await reserveAiCall(pool, settings, meta());
      await r.settle({});
      const { rows } = await pool.query(`SELECT status, cost_usd::float AS c FROM ai_usage`);
      expect(rows).toEqual([{ status: 'ok', c: expect.closeTo(ceilingUsd(meta()), 6) }]);
    });

    it('settle writes the real tokens and cost', async () => {
      const r = await reserveAiCall(pool, settings, meta({ feature: 'assist' }));
      await r.settle({ inputTokens: 2000, outputTokens: 500 });
      const { rows } = await pool.query(`SELECT status, feature, input_tokens, output_tokens, cost_usd::float AS c FROM ai_usage`);
      expect(rows).toEqual([{ status: 'ok', feature: 'assist', input_tokens: 2000, output_tokens: 500, c: expect.closeTo(0.00675, 6) }]);
    });

    it('fail without usage settles at zero and returns the mapped AiError', async () => {
      const r = await reserveAiCall(pool, settings, meta());
      const err = await r.fail(new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode: 403 }));
      expect(err).toMatchObject({ code: 'ai_auth' });
      const { rows } = await pool.query(`SELECT status, error_code, cost_usd::float AS c FROM ai_usage`);
      expect(rows).toEqual([{ status: 'error', error_code: 'ai_auth', c: 0 }]);
    });

    it('fail with usage charges the tokens already spent (R9-4)', async () => {
      const r = await reserveAiCall(pool, settings, meta());
      await r.fail(new Error('cut'), { inputTokens: 1000, outputTokens: 100 });
      const { rows } = await pool.query(`SELECT status, input_tokens, cost_usd::float AS c FROM ai_usage`);
      expect(rows).toEqual([{ status: 'error', input_tokens: 1000, c: expect.closeTo(0.00225, 6) }]);
    });

    it('rejects with the refusal and writes nothing', async () => {
      await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', 1)`);
      await expect(reserveAiCall(pool, settings, meta())).rejects.toMatchObject({ code: 'ai_budget' });
    });
  });

  it('monthSpendUsd sums the month by feature', async () => {
    await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'm', 'global', 'ok', 0.25), (NULL, 'seo', 'm', 'global', 'ok', 0.5), (NULL, 'seo', 'm', 'global', 'error', 0)`);
    await pool.query(`INSERT INTO ai_usage (at, actor_id, feature, model, region, status, cost_usd) VALUES (now() - interval '70 days', NULL, 'alt', 'm', 'global', 'ok', 9)`);
    expect(await monthSpendUsd(pool)).toEqual({ spent: 0.75, byFeature: { translate: 0.25, seo: 0.5 } });
  });
});
