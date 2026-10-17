import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { PermissionError } from '@/lib/server/action-result';
import { TEST_DATABASE_URL } from '@/test/helpers/db';

/*
 * Phase 9 D9 (R9-10, R9-23): the writing assistant streams its answer as plain
 * text through the one AI guard. Every call is a row of ai_usage (reserved
 * before, settled when the stream ends, failed when it is cut or refused), the
 * per-person limit and the budget apply, and nothing else is written: the
 * panel only fills the form.
 */

const STAFF = 'staff-assist';
let settings: AiSettings;
let draft = false;
let signedIn = true;
let pool: Pool;
vi.mock('@/lib/server/ai/settings', () => ({ cachedAiSettings: async () => settings }));
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: draft }) }));
vi.mock('@/db/client', () => ({ getPool: () => pool }));
/** What the route hands to after(): run by the test, as the platform would after the response. */
const afterWork: (() => unknown)[] = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (work: () => unknown) => {
    afterWork.push(work);
  },
}));
/** A model for the route's calls in place of the fake (null: the fake). */
let routeModel: LanguageModel | null = null;
vi.mock('@/lib/server/ai/client', async (orig) => {
  const real = await orig<typeof import('@/lib/server/ai/client')>();
  return { ...real, languageModel: (...args: Parameters<typeof real.languageModel>) => routeModel ?? real.languageModel(...args) };
});
vi.mock('@/lib/server/dal/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/dal/session')>()),
  requirePermission: async () => {
    if (!signedIn) throw new PermissionError('unauthenticated');
    return { userId: STAFF, email: 'x@furama.test', name: 'x', role: 'editor', ip: null };
  },
}));

import { maxDuration, POST } from '@/app/api/admin/ai/assist/route';
import { resetFake, setFakeFlags } from '@/lib/server/ai/fake';
import { ASSIST_TIMEOUT_MS, assistStream } from '@/lib/server/ai/assist';

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

/** A model that sends "Hello" and then waits, until its call is aborted. */
function hanging() {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'text-start', id: 't' });
          c.enqueue({ type: 'text-delta', id: 't', delta: 'Hello' });
          abortSignal?.addEventListener('abort', () => c.error(abortSignal.reason ?? new DOMException('aborted', 'AbortError')));
        },
      }),
    }),
  });
}

/** A model that sends "Hello", then fails mid-stream. */
function breaking() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'text-start', id: 't' });
          c.enqueue({ type: 'text-delta', id: 't', delta: 'Hello' });
          c.enqueue({ type: 'error', error: new Error('connection reset') });
          c.enqueue({ type: 'finish', finishReason: { unified: 'error', raw: undefined }, usage: USAGE });
          c.close();
        },
      }),
    }),
  });
}

const usage = async () =>
  (await pool.query(`SELECT feature, status, error_code, input_tokens, output_tokens, actor_id FROM ai_usage ORDER BY id`)).rows;

const ORIGIN = 'http://localhost:3000';
const post = (body: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}) =>
  POST(
    new Request(`${ORIGIN}/api/admin/ai/assist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init.headers ?? { origin: ORIGIN }) },
      body: JSON.stringify(body),
      signal: init.signal,
    }),
  );
const ok = { action: 'shorten', text: 'A long story about the restaurant.', locale: 'en' };

vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!TEST_DATABASE_URL)('the writing assistant (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query('TRUNCATE ai_usage');
    await pool.query(`DELETE FROM staff_user WHERE id = $1`, [STAFF]);
    await pool.end();
  });
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    resetFake();
    settings = AiSettingsSchema.parse({ brandVoice: 'Warm and calm' });
    draft = false;
    signedIn = true;
    routeModel = null;
    afterWork.length = 0;
    await pool.query('TRUNCATE ai_usage');
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`, [STAFF]);
  });
  afterEach(() => {
    resetFake();
    vi.unstubAllEnvs();
  });

  describe('assistStream', () => {
    const input = (o: Partial<Parameters<typeof assistStream>[1]> = {}) => ({
      action: 'rewrite' as const,
      text: 'The terrace opens at dusk.',
      locale: 'vi',
      actorId: STAFF,
      signal: new AbortController().signal,
      ...o,
    });

    it('streams plain text from the model and settles one ai_usage row with the real tokens', async () => {
      const res = await assistStream(pool, input());
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('«rewrite» The terrace opens at dusk.');
      // The fake model reports 100 in, 50 out (lib/server/ai/fake.ts).
      expect(await usage()).toEqual([{ feature: 'assist', status: 'ok', error_code: null, input_tokens: 100, output_tokens: 50, actor_id: STAFF }]);
    });

    it('sends the action and the instructions to the model, and passes the abort signal on', async () => {
      const model = hanging();
      const ctl = new AbortController();
      const res = await assistStream(pool, input({ action: 'brand', maxLength: 200, signal: ctl.signal }), { model });
      ctl.abort();
      await res.text().catch(() => '');
      const call = model.doStreamCalls[0];
      expect(call.abortSignal).toBeDefined();
      const sent = JSON.stringify(call.prompt);
      expect(sent).toContain('TASK: assist\\nACTION: brand');
      expect(sent).toContain('Write in Vietnamese.');
      expect(sent).toContain('at most 200 characters');
      expect(sent).toContain('Brand voice: Warm and calm');
      expect(sent).toContain('The terrace opens at dusk.');
    });

    it('cancelled mid-stream: the row is an error (ai_failed), nothing else is written', async () => {
      const ctl = new AbortController();
      const res = await assistStream(pool, input({ signal: ctl.signal }), { model: hanging() });
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('Hello');
      ctl.abort();
      await reader.read().catch(() => null);
      await vi.waitFor(async () => expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_failed' })]));
    });

    it('the reader going away (the panel closed) fails the row too', async () => {
      const res = await assistStream(pool, input(), { model: hanging() });
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await vi.waitFor(async () => expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_failed' })]));
    });

    it('hands the work that closes the row to keepAlive: once it is done, a cancelled call has left pending', async () => {
      // On Vercel the function may be frozen once the client has gone; the route keeps it alive with after().
      const kept: Promise<void>[] = [];
      const res = await assistStream(pool, input({ keepAlive: (work) => kept.push(work) }), { model: hanging() });
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      expect(kept).toHaveLength(1);
      await Promise.all(kept);
      expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_failed' })]);
    });

    it('a call read to its end closes the row within the kept-alive work too', async () => {
      const kept: Promise<void>[] = [];
      const res = await assistStream(pool, input({ keepAlive: (work) => kept.push(work) }));
      await res.text();
      await Promise.all(kept);
      expect((await usage()).map((r) => r.status)).toEqual(['ok']);
    });

    it('stops the model call well before the route’s maxDuration, so the platform never kills it first', () => {
      expect(ASSIST_TIMEOUT_MS).toBeLessThanOrEqual((maxDuration - 8) * 1000);
    });

    it('a signal aborted before the call reserves nothing', async () => {
      const ctl = new AbortController();
      ctl.abort();
      await expect(assistStream(pool, input({ signal: ctl.signal }))).rejects.toMatchObject({ code: 'ai_failed' });
      expect(await usage()).toEqual([]);
    });

    it('a Vertex failure before the first words is thrown (the route answers JSON), and recorded', async () => {
      setFakeFlags({ fail: 'assist:429' });
      await expect(assistStream(pool, input())).rejects.toMatchObject({ statusCode: 429 });
      expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_quota' })]);
    });

    it('a failure after the first words cuts the stream (the panel keeps the form as it was)', async () => {
      const res = await assistStream(pool, input(), { model: breaking() });
      await expect(res.text()).rejects.toBeDefined();
      await vi.waitFor(async () => expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_failed' })]));
    });

    it('refuses when the feature is off, or "brand" without a brand voice', async () => {
      settings = AiSettingsSchema.parse({ brandVoice: 'Warm', features: { assist: { enabled: false } } });
      await expect(assistStream(pool, input())).rejects.toMatchObject({ code: 'ai_off' });
      settings = AiSettingsSchema.parse({ brandVoice: '  ' });
      await expect(assistStream(pool, input({ action: 'brand' }))).rejects.toMatchObject({ code: 'ai_off', params: { missing: 'brandVoice' } });
      expect(await usage()).toEqual([]);
    });

    it('is refused over the budget, and counts toward the budget', async () => {
      settings = AiSettingsSchema.parse({ brandVoice: 'Warm', budgetUsd: 0 });
      await expect(assistStream(pool, input())).rejects.toMatchObject({ code: 'ai_budget' });
      expect(await usage()).toEqual([]);
    });
  });

  describe('POST /api/admin/ai/assist', () => {
    it('streams the suggestion to a signed-in Editor', async () => {
      const res = await post(ok);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe(`«shorten» ${ok.text}`);
    });

    it('refuses a caller without a session with 403, before any call', async () => {
      signedIn = false;
      const res = await post(ok);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'forbidden' });
      expect(await usage()).toEqual([]);
    });

    it('refuses another origin (403) and Draft Mode (409 ai_preview)', async () => {
      expect((await post(ok, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
      draft = true;
      const res = await post(ok);
      expect([res.status, (await res.json()).code]).toEqual([409, 'ai_preview']);
      expect(await usage()).toEqual([]);
    });

    it('answers 400 invalid for text over 4 000 characters, an unknown action or language, a bad maximum', async () => {
      const bad = [
        { ...ok, text: 'x'.repeat(4001) },
        { ...ok, text: '   ' },
        { ...ok, action: 'translate' },
        { ...ok, locale: 'xx' },
        { ...ok, maxLength: 0 },
        { ...ok, maxLength: 1.5 },
      ];
      for (const body of bad) {
        const res = await post(body);
        expect([res.status, (await res.json()).code]).toEqual([400, 'invalid']);
      }
      expect((await post({ ...ok, text: 'x'.repeat(4000) })).status).toBe(200);
    });

    it('applies the per-person limit: the eleventh call in a minute is 429', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await post(ok);
        expect(res.status).toBe(200);
        await res.text();
      }
      const res = await post(ok);
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ code: 'ai_rate_minute', message: 'Bạn đã dùng AI 10 lần trong một phút. Thử lại sau ít giây.' });
      expect((await usage()).filter((r) => r.status === 'ok')).toHaveLength(10);
    });

    it('a Vertex failure before the stream is JSON with the Vietnamese message', async () => {
      setFakeFlags({ fail: 'assist:429' });
      const res = await post(ok);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: 'ai_quota', message: 'Hết quota Vertex.' });
    });

    it('"brand" without a brand voice says what is missing', async () => {
      settings = AiSettingsSchema.parse({});
      const res = await post({ ...ok, action: 'brand' });
      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/giọng thương hiệu/);
    });

    it('the request aborted mid-stream stops the model call; the work kept alive with after() fails the row', async () => {
      routeModel = hanging();
      const ctl = new AbortController();
      const res = await post(ok, { signal: ctl.signal });
      const reader = res.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('Hello');
      // The body is not cancelled here: only the request's signal can end the hanging model's call.
      ctl.abort();
      expect(afterWork).toHaveLength(1);
      await Promise.all(afterWork.map((work) => work()));
      expect(await usage()).toEqual([expect.objectContaining({ status: 'error', error_code: 'ai_failed' })]);
    });
  });
});
