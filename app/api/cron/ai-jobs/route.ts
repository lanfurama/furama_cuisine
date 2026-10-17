import { getPool } from '@/db/client';
import { hasRunnableJob } from '@/lib/server/ai/jobs';
import { RUN_BUDGET_MS, runTranslationJobs } from '@/lib/server/content-admin/machine-translations';
import { cronAuthorized } from '@/lib/server/cron';

/*
 * Vercel Cron, hourly on the hour with the outbox (vercel.json, R9-16: Neon
 * Free wakes once an hour for both): runs what the buttons' after() left,
 * a job queued when its time ran out, and a job whose function died holding
 * its lease (R9-2). With nothing to run the answer comes after one SELECT.
 * Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12). Reading
 * request.headers keeps the handler out of prerendering
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:124).
 * The answer is counts or an error code.
 */

/** Seconds; runs stop starting documents 30 s before RUN_BUDGET_MS (240 s), so the last call and its write fit. */
export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const pool = getPool();
    if (!(await hasRunnableJob(pool))) return Response.json({ jobs: 0, docs: 0 }, { headers: NO_STORE });
    return Response.json(await runTranslationJobs(pool, { budgetMs: RUN_BUDGET_MS }), { headers: NO_STORE });
  } catch (error) {
    console.error(`[cron:ai-jobs] run failed code=${(error as { code?: string } | null)?.code ?? 'unknown'}`);
    return Response.json({ error: 'run_failed' }, { status: 500, headers: NO_STORE });
  }
}
