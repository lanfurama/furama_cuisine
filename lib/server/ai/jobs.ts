import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { Db } from '@/db/client';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { LISTED_LOCALE_CODES } from '@/lib/i18n/site-locales';
import type { ActionResult } from '@/lib/server/action-result';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy } from '@/lib/server/conflict';

/*
 * Bulk translation jobs (spec §9.3, R9-9, R9-16, R9-18), the ai_jobs half:
 * create, claim under a lease, progress, pause, resume, cancel. Only SQL of
 * ai_jobs lives here (R9-17): what a job translates and writes is the CMS's
 * (lib/server/content-admin/machine-translations.ts), which runs the loop.
 *
 * One live job (queued, running or paused) per language: ai_jobs_one_live_idx.
 * A run claims a job (FOR UPDATE SKIP LOCKED) for LEASE_SECONDS and renews the
 * lease after each document; a function that dies leaves the lease to run out,
 * and the next run (after() of a button, or the hourly cron) claims it again.
 * Every write after a claim is fenced by `attempts`, which the claim bumps:
 * a run whose lease ran out and was claimed again can no longer write.
 *
 * Staff's own writes (create, resume, cancel) have their audit row; a run's
 * status changes are the job's bookkeeping, and what it translates is audited
 * where it is written.
 */

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled';

export type JobProgress = {
  /** Units written: an item's translation, or one key of a strings screen. */
  done: number;
  /** Units the model got wrong (a lost name or variable, too long): left empty and tried again. */
  failed: number;
  /** Units still missing at the last count (not the skipped ones); null before the first run. */
  remaining: number | null;
  /** Units given up on after STRIKES failures in this job (at most MAX_SKIPPED), for the panel. */
  skipped: string[];
  /** Failures so far of each unit that has failed and not been written. */
  strikes: Record<string, number>;
};

/** A unit failing this many times in one job is skipped until the job ends. */
export const STRIKES = 3;
const MAX_SKIPPED = 200;
export const LEASE_SECONDS = 300;

export type JobView = {
  id: string;
  locale: string;
  status: JobStatus;
  progress: JobProgress;
  /** An ActionCode (ai_quota, ai_budget…), db_error, or locale_unlisted. */
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimedJob = { id: string; locale: string; attempts: number; progress: JobProgress };

export function normaliseProgress(raw: unknown): JobProgress {
  const p = (raw ?? {}) as Partial<JobProgress>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    done: n(p.done),
    failed: n(p.failed),
    remaining: typeof p.remaining === 'number' ? n(p.remaining) : null,
    skipped: Array.isArray(p.skipped) ? p.skipped.filter((s): s is string => typeof s === 'string').slice(0, MAX_SKIPPED) : [],
    strikes: p.strikes && typeof p.strikes === 'object' ? Object.fromEntries(Object.entries(p.strikes).map(([k, v]) => [k, n(v)])) : {},
  };
}

/** Records one more failure of `unit`; on its STRIKES-th the unit joins `skipped`. */
export function strike(progress: JobProgress, unit: string): void {
  progress.failed += 1;
  const count = (progress.strikes[unit] ?? 0) + 1;
  if (count < STRIKES) {
    progress.strikes[unit] = count;
    return;
  }
  delete progress.strikes[unit];
  if (!progress.skipped.includes(unit) && progress.skipped.length < MAX_SKIPPED) progress.skipped.push(unit);
}

/** A language a job may translate (R9-18): listed in lib/i18n/site-locales.ts, on or off, and not the default. */
export const jobLocale = (code: string): boolean => code !== DEFAULT_LOCALE && LISTED_LOCALE_CODES.includes(code);

const VIEW = `j.id::text AS id, j.locale, j.status, j.progress, j.error, s.name AS "createdBy",
              to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              to_char(j.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"`;
const view = (r: JobView): JobView => ({ ...r, progress: normaliseProgress(r.progress) });

/** "Dịch tất cả phần còn thiếu bằng AI": a queued job, or `conflict` naming who created the live one. */
export async function createJob(pool: Pool, actor: AuditActor, locale: string): Promise<ActionResult<{ id: string }>> {
  if (!jobLocale(locale)) return { ok: false, code: 'invalid', fieldErrors: { locale: ['Chọn một ngôn ngữ khác tiếng Anh trong danh sách ngôn ngữ của web.'] } };
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ai_jobs (locale, created_by) VALUES ($1, $2)
       ON CONFLICT (locale) WHERE status IN ('queued', 'running', 'paused') DO NOTHING RETURNING id::text`,
      [locale, actor.id],
    );
    if (!rows[0]) {
      const live = await client.query<{ created_by: string | null; created_at: Date }>(
        `SELECT created_by, created_at FROM ai_jobs WHERE locale = $1 AND status IN ('queued', 'running', 'paused')`,
        [locale],
      );
      return conflictBy(client, live.rows[0]?.created_by ?? null, live.rows[0]?.created_at ?? new Date());
    }
    await insertAudit(client, actor, { action: 'create', entityType: 'ai_jobs', entityId: rows[0].id, locale, after: { status: 'queued' } });
    return { ok: true, data: { id: rows[0].id } } as const;
  });
}

/**
 * The next job to run: queued, or running with its lease run out (a function
 * died). `ids` limits the claim to those jobs (the after() of a button). A job
 * whose language left the list is cancelled with locale_unlisted (R9-18) and
 * the next one is claimed.
 */
export async function claimJob(pool: Pool, opts: { ids?: readonly string[] } = {}): Promise<ClaimedJob | null> {
  for (;;) {
    const { rows } = await pool.query<{ id: string; locale: string; attempts: number; progress: unknown }>(
      `UPDATE ai_jobs j
          SET status = 'running', attempts = j.attempts + 1, locked_until = now() + make_interval(secs => $2), error = NULL, updated_at = now()
        WHERE j.id = (SELECT id FROM ai_jobs
                       WHERE (status = 'queued' OR (status = 'running' AND locked_until < now()))
                         AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[]))
                       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING j.id::text, j.locale, j.attempts, j.progress`,
      [opts.ids ? [...opts.ids] : null, LEASE_SECONDS],
    );
    const row = rows[0];
    if (!row) return null;
    const job: ClaimedJob = { id: row.id, locale: row.locale, attempts: row.attempts, progress: normaliseProgress(row.progress) };
    if (jobLocale(job.locale)) return job;
    await fenced(pool, job, `status = 'cancelled', error = 'locale_unlisted', locked_until = NULL`, []);
  }
}

/** An UPDATE of a claimed job that holds only while this run's claim does. */
async function fenced(pool: Pool, job: ClaimedJob, set: string, values: unknown[]): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE ai_jobs SET ${set}, updated_at = now() WHERE id = $1 AND attempts = $2 AND status = 'running'`, [
    job.id,
    job.attempts,
    ...values,
  ]);
  return rowCount === 1;
}

/** Saves the progress and renews the lease; false: the job was cancelled, or another run holds it now. */
export function saveProgress(pool: Pool, job: ClaimedJob, progress: JobProgress): Promise<boolean> {
  return fenced(pool, job, `progress = $3::jsonb, locked_until = now() + make_interval(secs => $4)`, [JSON.stringify(progress), LEASE_SECONDS]);
}

/**
 * The end of a run: `done` (nothing left), `paused` with the code (Vertex
 * trouble, the budget: "Tiếp tục" picks it up), or `queued` (the run's time
 * ran out, R9-16: the next cron or "Chạy tiếp ngay" goes on).
 */
export function endRun(pool: Pool, job: ClaimedJob, end: { status: 'done' | 'queued' } | { status: 'paused'; error: string }, progress: JobProgress): Promise<boolean> {
  return fenced(pool, job, `status = $3, error = $4, progress = $5::jsonb, locked_until = NULL`, [
    end.status,
    end.status === 'paused' ? end.error : null,
    JSON.stringify(progress),
  ]);
}

type Lock = { status: JobStatus; locale: string; error: string | null };

async function lockJob(pool: Pool, id: string, fn: (job: Lock, client: PoolClient) => Promise<ActionResult>): Promise<ActionResult> {
  if (!/^\d{1,18}$/.test(id)) return { ok: false, code: 'not_found' };
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<Lock>('SELECT status, locale, error FROM ai_jobs WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ? fn(rows[0], client) : ({ ok: false, code: 'not_found' } as const);
  });
}

/**
 * "Tiếp tục" (a paused job) and "Chạy tiếp ngay" (a queued one, waiting for
 * the next run, R9-16): the job is queued, its error cleared; the caller then
 * runs it in after(). A running, done or cancelled job is `not_allowed`.
 */
export function resumeJob(pool: Pool, actor: AuditActor, id: string): Promise<ActionResult> {
  return lockJob(pool, id, async (job, client) => {
    if (job.status === 'queued') return { ok: true, data: null };
    if (job.status !== 'paused') return { ok: false, code: 'not_allowed' };
    await client.query(`UPDATE ai_jobs SET status = 'queued', error = NULL, locked_until = NULL, updated_at = now() WHERE id = $1`, [id]);
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'ai_jobs',
      entityId: id,
      locale: job.locale,
      before: { status: job.status, error: job.error },
      after: { status: 'queued' },
    });
    return { ok: true, data: null };
  });
}

/** "Hủy": a live job is cancelled for good (a run in flight stops at its next document); a finished one is `not_allowed`. */
export function cancelJob(pool: Pool, actor: AuditActor, id: string): Promise<ActionResult> {
  return lockJob(pool, id, async (job, client) => {
    if (job.status === 'done' || job.status === 'cancelled') return { ok: false, code: 'not_allowed' };
    await client.query(`UPDATE ai_jobs SET status = 'cancelled', locked_until = NULL, updated_at = now() WHERE id = $1`, [id]);
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'ai_jobs',
      entityId: id,
      locale: job.locale,
      before: { status: job.status, error: job.error },
      after: { status: 'cancelled' },
    });
    return { ok: true, data: null };
  });
}

/** The newest job of each language, whatever its status (the panel and its 5-second poll, R9-24). */
export async function latestJobs(db: Db): Promise<JobView[]> {
  const { rows } = await db.query<JobView>(
    `SELECT DISTINCT ON (j.locale) ${VIEW} FROM ai_jobs j LEFT JOIN staff_user s ON s.id = j.created_by ORDER BY j.locale, j.id DESC`,
  );
  return rows.map(view);
}

export async function jobById(db: Db, id: string): Promise<JobView | null> {
  const { rows } = await db.query<JobView>(`SELECT ${VIEW} FROM ai_jobs j LEFT JOIN staff_user s ON s.id = j.created_by WHERE j.id = $1::bigint`, [id]);
  return rows[0] ? view(rows[0]) : null;
}

/** The cron's first and, most hours, only statement (R9-2): is there a job to claim? */
export async function hasRunnableJob(db: Db): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM ai_jobs WHERE status = 'queued' OR (status = 'running' AND locked_until < now()) LIMIT 1`);
  return rowCount === 1;
}
