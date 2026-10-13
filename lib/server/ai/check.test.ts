import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { TEST_DATABASE_URL } from '@/test/helpers/db';
import { checkConnection } from './check';
import { resetFake } from './fake';

vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }));

const base = AiSettingsSchema.parse({});
const withFeatures = (o: Record<string, object>): AiSettings => AiSettingsSchema.parse({ features: o });
const OPTS = { deadlineMs: 20_000, withImage: true };
let pool: Pool;

describe.skipIf(!TEST_DATABASE_URL)('connection check (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query('TRUNCATE ai_usage');
    await pool.end();
  });
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('GOOGLE_VERTEX_API_KEY', undefined as unknown as string);
    delete process.env.GOOGLE_VERTEX_API_KEY;
    await pool.query('TRUNCATE ai_usage');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFake();
  });

  it('merges the features that share a model and region into one row', async () => {
    const rows = await checkConnection(pool, base, OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: 'gemini-3.8-flash', region: 'global', features: ['translate', 'assist', 'seo', 'alt'] });
  });

  it('does not check a feature that is off, and splits a different pair', async () => {
    const s = withFeatures({ alt: { enabled: false }, seo: { model: 'claude-sonnet-5-5', region: 'eu' } });
    const rows = await checkConnection(pool, s, OPTS);
    expect(rows.map((r) => `${r.model}/${r.region}:${r.features.join(',')}`)).toEqual([
      'gemini-3.8-flash/global:translate,assist',
      'claude-sonnet-5-5/eu:seo',
    ]);
  });

  it('runs all five steps ok in fake mode, and writes a check row per model call', async () => {
    const [row] = await checkConnection(pool, base, OPTS);
    expect(row.steps.map((s) => [s.step, s.ok])).toEqual([
      ['env', true],
      ['token', true],
      ['text', true],
      ['structured', true],
      ['image', true],
    ]);
    expect(row.steps.find((s) => s.step === 'text')!.tokens).toBeGreaterThan(0);
    const { rows } = await pool.query(`SELECT feature, actor_id, status FROM ai_usage`);
    expect(rows).toEqual(Array(3).fill({ feature: 'check', actor_id: null, status: 'ok' }));
  });

  it('skips the image step unless asked', async () => {
    const [row] = await checkConnection(pool, base, { ...OPTS, withImage: false });
    expect(row.steps.map((s) => s.step)).toEqual(['env', 'token', 'text', 'structured']);
  });

  it('stops a pair at the first failure, with the Vietnamese-mapped code', async () => {
    vi.stubEnv('AI_FAKE_FAIL', 'check:403');
    const [row] = await checkConnection(pool, base, OPTS);
    expect(row.steps.map((s) => [s.step, s.ok, s.code])).toEqual([
      ['env', true, undefined],
      ['token', true, undefined],
      ['text', false, 'ai_auth'],
    ]);
    const { rows } = await pool.query(`SELECT status, error_code FROM ai_usage`);
    expect(rows).toEqual([{ status: 'error', error_code: 'ai_auth' }]);
  });

  it('off mode: only the env step, and it failed', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    for (const n of ['GCP_PROJECT_ID', 'GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'GCP_SERVICE_ACCOUNT_KEY']) vi.stubEnv(n, '');
    const [row] = await checkConnection(pool, base, OPTS);
    expect(row.steps).toEqual([{ step: 'env', ok: false, ms: expect.any(Number), code: 'ai_off' }]);
  });

  it('a spent deadline leaves the remaining pairs unrun and flagged', async () => {
    const s = withFeatures({ seo: { model: 'claude-sonnet-5-5', region: 'eu' } });
    const rows = await checkConnection(pool, s, { deadlineMs: 0, withImage: true });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.steps.length === 0 && r.timedOut === true)).toBe(true);
  });

  it('a token exchange that never answers ends at the step time as ai_failed', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    for (const n of ['GCP_PROJECT_ID', 'GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID']) vi.stubEnv(n, 'x');
    const hung = { getAccessToken: () => new Promise<never>(() => {}) };
    const t0 = Date.now();
    const [row] = await checkConnection(pool, base, { deadlineMs: 300, withImage: true }, { auth: () => hung });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(row.steps.map((s) => [s.step, s.ok, s.code])).toEqual([
      ['env', true, undefined],
      ['token', false, 'ai_failed'],
    ]);
  });
});
