import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { TEST_DATABASE_URL } from '@/test/helpers/db';

let settings: AiSettings;
let draft = false;
let pool: Pool;
const calls: { items: unknown[] }[] = [];
vi.mock('./settings', () => ({ cachedAiSettings: async () => settings }));
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: draft }) }));
vi.mock('@/db/client', () => ({ getPool: () => pool }));
vi.mock('@/lib/server/dal/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/dal/session')>()),
  requirePermission: async () => ({ userId: 'staff-route', email: 'x@furama.test', name: 'x', role: 'editor', ip: null }),
}));
vi.mock('./translate', async (orig) => ({
  ...(await orig<typeof import('./translate')>()),
  translateItems: async (_p: unknown, input: { items: unknown[] }) => {
    calls.push(input);
    return { results: [], model: 'gemini-3.8-flash' };
  },
}));

import { POST } from '@/app/api/admin/ai/translate/route';

const ORIGIN = 'http://localhost:3000';
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(new Request(`${ORIGIN}/api/admin/ai/translate`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const ok = { locale: 'vi', items: [{ id: 'a', text: 'Hello' }] };

describe.skipIf(!TEST_DATABASE_URL)('POST /api/admin/ai/translate', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(() => pool.end());
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    settings = AiSettingsSchema.parse({});
    draft = false;
    calls.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('answers 200 with results for a good request', async () => {
    expect((await post(ok)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('refuses another origin with 403 before any call', async () => {
    const res = await post(ok, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(calls).toHaveLength(0);
  });

  it('refuses Draft Mode with 409 ai_preview', async () => {
    draft = true;
    const res = await post(ok);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ai_preview' });
  });

  it('answers ai_off when AI is not configured or the feature is disabled', async () => {
    settings = AiSettingsSchema.parse({ features: { translate: { enabled: false } } });
    expect(await (await post(ok)).json()).toMatchObject({ code: 'ai_off' });
    settings = AiSettingsSchema.parse({});
    vi.stubEnv('AI_PROVIDER', '');
    for (const n of ['GCP_PROJECT_ID', 'GCP_SERVICE_ACCOUNT_KEY', 'GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID']) vi.stubEnv(n, '');
    expect(await (await post(ok)).json()).toMatchObject({ code: 'ai_off' });
    expect(calls).toHaveLength(0);
  });

  it('answers 400 invalid for the default or an unknown locale, an unknown key, duplicate ids, a bad ICU English', async () => {
    const bad = [
      { ...ok, locale: 'en' },
      { ...ok, locale: 'xx' },
      { locale: 'vi', items: [{ id: 'a', text: 'Hi', key: 'no.such.key' }] },
      { locale: 'vi', items: [{ id: 'a', text: 'Hi' }, { id: 'a', text: 'Yo' }] },
      { locale: 'vi', items: [{ id: 'a', text: '{', key: 'error.party_too_large' }] },
      { locale: 'vi', items: [{ id: 'a', text: 'no vars here', key: 'error.party_too_large' }] },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect([res.status, (await res.json()).code]).toEqual([400, 'invalid']);
    }
    expect(calls).toHaveLength(0);
  });

  it('takes context, maxLength and vars from the registry, not from the client', async () => {
    await post({ locale: 'vi', items: [{ id: 'a', text: 'For more than {max} guests, please call us on {phone}.', key: 'error.party_too_large', maxLength: 5, vars: [], context: 'evil' } ] });
    const item = calls[0].items[0] as { context: string; maxLength: number; vars: string[] };
    expect(item.maxLength).toBe(140);
    expect(item.vars).toEqual(['max', 'phone']);
    expect(item.context).not.toBe('evil');
  });
});
