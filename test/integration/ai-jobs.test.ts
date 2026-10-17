import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { cancelJob, claimJob, createJob, endRun, hasRunnableJob, jobById, latestJobs, resumeJob, saveProgress } from '@/lib/server/ai/jobs';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 9 D8 (spec §9.3, R9-9, R9-16, R9-18): the ai_jobs table's own rules.
 * One live job per language; a claim under a lease that a dead function's
 * successor takes over; every write of a run fenced by its claim; staff's
 * create, resume and cancel audited (and accepted by audit_log's CHECK).
 */

const pool = getPool();
const ADMIN: AuditActor = { id: 'staff-d8-admin', email: 'admin-d8@furama.test', name: 'Hà' };

describe.skipIf(!TEST_DATABASE_URL)('ai_jobs (database)', () => {
  beforeEach(async () => {
    await query('TRUNCATE ai_jobs CASCADE');
    await query(`DELETE FROM audit_log WHERE entity_type = 'ai_jobs'`);
    await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'admin') ON CONFLICT (id) DO NOTHING`, [
      ADMIN.id,
      ADMIN.name,
      ADMIN.email,
    ]);
  });
  afterAll(async () => {
    await query('TRUNCATE ai_jobs CASCADE');
    await query(`DELETE FROM audit_log WHERE entity_type = 'ai_jobs'`);
    await query(`DELETE FROM staff_user WHERE id = $1`, [ADMIN.id]);
  });

  it('creates a queued job with its audit row, and refuses a second live job for the language (ai_jobs_one_live_idx)', async () => {
    const first = await createJob(pool, ADMIN, 'vi');
    expect(first).toMatchObject({ ok: true, data: { id: expect.stringMatching(/^\d+$/) } });
    const id = (first as { data: { id: string } }).data.id;
    expect(await jobById(pool, id)).toMatchObject({ locale: 'vi', status: 'queued', createdBy: 'Hà', progress: { done: 0, remaining: null, skipped: [] } });
    expect(await createJob(pool, ADMIN, 'vi')).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Hà' } });
    expect((await query(`SELECT action, entity_id, locale, actor_id FROM audit_log WHERE entity_type = 'ai_jobs'`))).toEqual([
      { action: 'create', entity_id: id, locale: 'vi', actor_id: ADMIN.id },
    ]);
    // The index itself, past the app: a second live row cannot exist.
    await expect(query(`INSERT INTO ai_jobs (locale, status) VALUES ('vi', 'paused')`)).rejects.toMatchObject({ code: '23505' });
    // A finished job leaves room for a new one.
    await query(`UPDATE ai_jobs SET status = 'done' WHERE id = $1`, [id]);
    expect(await createJob(pool, ADMIN, 'vi')).toMatchObject({ ok: true });
  });

  it('takes only a listed language other than the default (R9-18)', async () => {
    for (const locale of ['en', 'fr', 'xx', '']) expect(await createJob(pool, ADMIN, locale)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await query('SELECT count(*)::int AS n FROM ai_jobs'))[0].n).toBe(0);
  });

  it('claims a queued job once (SKIP LOCKED), renews its lease, and a run without the claim cannot write', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    expect(await hasRunnableJob(pool)).toBe(true);
    const [a, b] = await Promise.all([claimJob(pool), claimJob(pool)]);
    const job = a ?? b!;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(job).toMatchObject({ id: data.id, locale: 'vi', attempts: 1 });
    expect(await hasRunnableJob(pool)).toBe(false);
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'running' });

    const progress = { ...job.progress, done: 4, remaining: 9 };
    expect(await saveProgress(pool, job, progress)).toBe(true);
    expect((await jobById(pool, data.id))!.progress).toMatchObject({ done: 4, remaining: 9 });
    expect(await saveProgress(pool, { ...job, attempts: 0 }, progress)).toBe(false);
  });

  it('claims again a job whose lease ran out (a dead function); the dead run’s writes are refused', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    const dead = (await claimJob(pool))!;
    expect(await claimJob(pool)).toBeNull();
    await query(`UPDATE ai_jobs SET locked_until = now() - interval '1 second' WHERE id = $1`, [data.id]);
    expect(await hasRunnableJob(pool)).toBe(true);
    const next = (await claimJob(pool))!;
    expect(next).toMatchObject({ id: data.id, attempts: 2 });
    expect(await saveProgress(pool, dead, { ...dead.progress, done: 99 })).toBe(false);
    expect(await endRun(pool, dead, { status: 'done' }, dead.progress)).toBe(false);
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'running', progress: { done: 0 } });
  });

  it('claims only the ids it is given (the after() of a button)', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    expect(await claimJob(pool, { ids: ['999999'] })).toBeNull();
    expect(await claimJob(pool, { ids: [data.id] })).toMatchObject({ id: data.id });
  });

  it('cancels, at its claim, a job whose language left the list (locale_unlisted)', async () => {
    const { rows } = await pool.query<{ id: string }>(`INSERT INTO ai_jobs (locale) VALUES ('fr') RETURNING id::text`);
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    expect(await claimJob(pool)).toMatchObject({ id: data.id, locale: 'vi' });
    expect(await jobById(pool, rows[0].id)).toMatchObject({ status: 'cancelled', error: 'locale_unlisted' });
  });

  it('ends a run as done, paused with its code, or queued again when its time ran out (R9-16)', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    let job = (await claimJob(pool))!;
    expect(await endRun(pool, job, { status: 'queued' }, { ...job.progress, done: 2, remaining: 5 })).toBe(true);
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'queued', error: null, progress: { done: 2 } });
    const locked = (await query<{ locked_until: Date | null }>('SELECT locked_until FROM ai_jobs WHERE id = $1', [data.id]))[0];
    expect(locked.locked_until).toBeNull();

    job = (await claimJob(pool))!;
    expect(await endRun(pool, job, { status: 'paused', error: 'ai_quota' }, job.progress)).toBe(true);
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'paused', error: 'ai_quota' });
    expect(await claimJob(pool)).toBeNull();
  });

  it('"Tiếp tục" queues a paused job and clears its error; "Chạy tiếp ngay" accepts a queued one; a running job is not_allowed', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    // Queued with work done (a run whose time ran out): accepted, nothing to change.
    await query(`UPDATE ai_jobs SET progress = '{"done":3,"failed":0,"remaining":7}' WHERE id = $1`, [data.id]);
    expect(await resumeJob(pool, ADMIN, data.id)).toEqual({ ok: true, data: null });
    const job = (await claimJob(pool))!;
    expect(await resumeJob(pool, ADMIN, data.id)).toMatchObject({ ok: false, code: 'not_allowed' });
    await endRun(pool, job, { status: 'paused', error: 'ai_budget' }, job.progress);
    expect(await resumeJob(pool, ADMIN, data.id)).toEqual({ ok: true, data: null });
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'queued', error: null, progress: { done: 3 } });
    expect(await query(`SELECT action, before, after FROM audit_log WHERE entity_type = 'ai_jobs' AND action = 'update'`)).toEqual([
      { action: 'update', before: { status: 'paused', error: 'ai_budget' }, after: { status: 'queued' } },
    ]);
    expect(await resumeJob(pool, ADMIN, '999999')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await resumeJob(pool, ADMIN, 'abc')).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('"Hủy" stops a job for good: a cancelled job is never claimed, and its run’s next write is refused', async () => {
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    const job = (await claimJob(pool))!;
    expect(await cancelJob(pool, ADMIN, data.id)).toEqual({ ok: true, data: null });
    expect(await saveProgress(pool, job, job.progress)).toBe(false);
    expect(await jobById(pool, data.id)).toMatchObject({ status: 'cancelled' });
    expect(await claimJob(pool)).toBeNull();
    expect(await cancelJob(pool, ADMIN, data.id)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await resumeJob(pool, ADMIN, data.id)).toMatchObject({ ok: false, code: 'not_allowed' });
    // The language is free for a new job.
    expect(await createJob(pool, ADMIN, 'vi')).toMatchObject({ ok: true });
  });

  it('lists the newest job of each language, finished ones included', async () => {
    const { data: old } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    await cancelJob(pool, ADMIN, old.id);
    const { data } = (await createJob(pool, ADMIN, 'vi')) as { data: { id: string } };
    await pool.query(`INSERT INTO ai_jobs (locale, status) VALUES ('fr', 'cancelled')`);
    const jobs = await latestJobs(pool);
    expect(jobs.map((j) => [j.locale, j.status, j.id === data.id])).toEqual([
      ['fr', 'cancelled', false],
      ['vi', 'queued', true],
    ]);
    expect(jobs[1].createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});
