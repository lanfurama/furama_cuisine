import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { getPool, query } from '@/db/client';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 9 D8 routes (spec §7.1, §9.3, R9-16, R9-24): creating, resuming and
 * cancelling a bulk job is Admin only, called straight or not; the poll is for
 * every staff member; a job runs in after(). requirePermission keeps its real
 * rule (roleCan) on a role the test picks: the route's own literal decides.
 */

const state = vi.hoisted(() => ({ role: null as null | 'admin' | 'editor', draft: false, settings: null as unknown, after: [] as (() => unknown)[] }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (task: () => unknown) => void state.after.push(task) }));
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: state.draft }) }));
vi.mock('@/lib/server/ai/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/server/ai/settings')>()), cachedAiSettings: async () => state.settings as AiSettings }));
vi.mock('@/lib/server/dal/session', async (orig) => {
  const real = await orig<typeof import('@/lib/server/dal/session')>();
  const { roleCan } = await import('@/lib/server/auth/permissions');
  return {
    ...real,
    requirePermission: async (permissions: Parameters<typeof real.requirePermission>[0]) => {
      if (!state.role) throw new real.PermissionError('unauthenticated');
      if (!roleCan(state.role, permissions)) throw new real.PermissionError('forbidden');
      return { userId: `staff-d8-${state.role}`, email: `${state.role}-d8@furama.test`, name: state.role === 'admin' ? 'Hà' : 'Lan', role: state.role, ip: null };
    },
  };
});

import { GET as list, POST as create } from '@/app/api/admin/ai/jobs/route';
import { POST as act } from '@/app/api/admin/ai/jobs/[id]/route';

const ORIGIN = 'http://localhost:3000';
/** A whole job is about a hundred fake calls, each with its usage and write transactions: past vitest's 5 s under load. */
const JOB_TIMEOUT_MS = 60_000;
const post = (path: string, body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
const createJob = (body: unknown = { locale: 'vi' }, origin?: string) => create(post('/api/admin/ai/jobs', body, origin));
const jobAction = (id: string, action: string, origin?: string) => act(post(`/api/admin/ai/jobs/${id}`, { action }, origin), { params: Promise.resolve({ id }) });
const jobs = () => query<{ id: string; status: string; error: string | null }>(`SELECT id::text, status, error FROM ai_jobs ORDER BY id`);

async function cleanUp() {
  await query('TRUNCATE ai_jobs, ai_usage CASCADE');
  for (const t of ['offer_i18n', 'cuisine_i18n', 'destination_i18n', 'experience_i18n', 'story_i18n', 'nav_item_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n', 'media_i18n']) {
    await query(`DELETE FROM ${t} WHERE locale = 'vi'`);
  }
  await query(`DELETE FROM content_strings WHERE locale = 'vi'`);
  await query(`DELETE FROM audit_log WHERE entity_type = 'ai_jobs' OR after->'meta' ? 'machine'`);
}

describe.skipIf(!TEST_DATABASE_URL)('/api/admin/ai/jobs (database)', { timeout: JOB_TIMEOUT_MS }, () => {
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    state.role = 'admin';
    state.draft = false;
    state.settings = AiSettingsSchema.parse({});
    state.after.length = 0;
    await cleanUp();
    for (const [id, role] of [['staff-d8-admin', 'admin'], ['staff-d8-editor', 'editor']]) {
      await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, $2) ON CONFLICT (id) DO NOTHING`, [id, role]);
    }
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await cleanUp();
    await query(`DELETE FROM staff_user WHERE id IN ('staff-d8-admin', 'staff-d8-editor')`);
    await getPool().end();
  });

  it('an Admin creates a job (201) and it runs in after(); a second one for the language is a 409 conflict', async () => {
    const res = await createJob();
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { id: string } };
    expect(await jobs()).toEqual([{ id: data.id, status: 'queued', error: null }]);
    expect(state.after).toHaveLength(1);
    const again = await createJob();
    expect([again.status, (await again.json()).code]).toEqual([409, 'conflict']);
    await state.after[0]();
    expect(await jobs()).toEqual([{ id: data.id, status: 'done', error: null }]);
  });

  it('refuses an Editor and a caller without a session (403), before anything is written', async () => {
    for (const role of ['editor', null] as const) {
      state.role = role;
      const res = await createJob();
      expect([res.status, (await res.json()).code]).toEqual([403, 'forbidden']);
    }
    expect(await jobs()).toEqual([]);
    expect(state.after).toHaveLength(0);
  });

  it('refuses another origin (403), a preview (409 ai_preview), AI off (409 ai_off) and a language it may not translate (400)', async () => {
    const answer = async (res: Response) => [res.status, (await res.json()).code];
    expect(await answer(await createJob({ locale: 'vi' }, 'https://evil.example'))).toEqual([403, 'forbidden']);
    state.draft = true;
    expect(await answer(await createJob())).toEqual([409, 'ai_preview']);
    state.draft = false;
    state.settings = AiSettingsSchema.parse({ features: { translate: { enabled: false } } });
    expect(await answer(await createJob())).toEqual([409, 'ai_off']);
    state.settings = AiSettingsSchema.parse({});
    for (const locale of ['en', 'fr', 'not a code']) expect(await answer(await createJob({ locale }))).toEqual([400, 'invalid']);
    expect(await jobs()).toEqual([]);
  });

  it('GET lists the newest job of each language for any staff member, none for a caller without a session', async () => {
    const { data } = (await (await createJob()).json()) as { data: { id: string } };
    state.role = 'editor';
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).jobs).toMatchObject([{ id: data.id, locale: 'vi', status: 'queued', createdBy: 'staff-d8-admin' }]);
    state.role = null;
    expect((await list()).status).toBe(403);
  });

  it('an Editor can neither resume nor cancel a job, even calling the route straight', async () => {
    const { data } = (await (await createJob()).json()) as { data: { id: string } };
    state.after.length = 0;
    await query(`UPDATE ai_jobs SET status = 'paused', error = 'ai_quota' WHERE id = $1`, [data.id]);
    state.role = 'editor';
    for (const action of ['resume', 'cancel']) {
      const res = await jobAction(data.id, action);
      expect([res.status, (await res.json()).code]).toEqual([403, 'forbidden']);
    }
    expect(await jobs()).toEqual([{ id: data.id, status: 'paused', error: 'ai_quota' }]);
    expect(state.after).toHaveLength(0);
  });

  it('"Tiếp tục" queues a paused job and runs it in after(); "Chạy tiếp ngay" takes a queued one; a running job is a 409', async () => {
    const { data } = (await (await createJob()).json()) as { data: { id: string } };
    state.after.length = 0;
    await query(`UPDATE ai_jobs SET status = 'paused', error = 'ai_quota' WHERE id = $1`, [data.id]);
    const res = await jobAction(data.id, 'resume');
    expect(res.status).toBe(200);
    expect(await jobs()).toEqual([{ id: data.id, status: 'queued', error: null }]);
    expect(state.after).toHaveLength(1);
    // Queued with work done (its time ran out): "Chạy tiếp ngay" is the same route.
    await query(`UPDATE ai_jobs SET progress = '{"done":4,"failed":0,"remaining":9}' WHERE id = $1`, [data.id]);
    expect((await jobAction(data.id, 'resume')).status).toBe(200);
    expect(state.after).toHaveLength(2);
    await query(`UPDATE ai_jobs SET status = 'running', locked_until = now() + interval '4 minutes' WHERE id = $1`, [data.id]);
    const running = await jobAction(data.id, 'resume');
    expect([running.status, (await running.json()).code]).toEqual([409, 'not_allowed']);
    // Resuming calls the model: AI must be on. Cancelling does not.
    state.settings = AiSettingsSchema.parse({ features: { translate: { enabled: false } } });
    expect((await jobAction(data.id, 'resume')).status).toBe(409);
    expect((await jobAction(data.id, 'cancel')).status).toBe(200);
    expect(await jobs()).toEqual([{ id: data.id, status: 'cancelled', error: null }]);
    const twice = await jobAction(data.id, 'cancel');
    expect([twice.status, (await twice.json()).code]).toEqual([409, 'not_allowed']);
  });

  it('refuses another origin, an unknown action and an unknown job', async () => {
    const { data } = (await (await createJob()).json()) as { data: { id: string } };
    expect((await jobAction(data.id, 'cancel', 'https://evil.example')).status).toBe(403);
    expect((await jobAction(data.id, 'delete')).status).toBe(400);
    expect((await jobAction('999999', 'cancel')).status).toBe(404);
    expect((await jobAction('x; DROP', 'cancel')).status).toBe(404);
    expect(await jobs()).toEqual([{ id: data.id, status: 'queued', error: null }]);
  });
});
