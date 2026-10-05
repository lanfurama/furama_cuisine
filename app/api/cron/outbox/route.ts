import { cronAuthorized } from '@/lib/server/cron';
import { drainOutbox } from '@/lib/server/email/drain';

/*
 * Vercel Cron, hourly (vercel.json; production deployments only):
 * sends what after() could not, and every retry that has come due (spec
 * §10.4). Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12).
 * Reading request.headers keeps the handler out of prerendering
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:124).
 * The answer is counts or an error code: no address, no secret.
 */

/** Seconds; the drain stops claiming at 240 s, so a send already claimed still has a minute to finish. */
export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const report = await drainOutbox({ budgetMs: 240_000, limit: 500 });
    return Response.json(report, { headers: NO_STORE });
  } catch (error) {
    console.error(`[cron:outbox] drain failed code=${(error as { code?: string } | null)?.code ?? 'unknown'}`);
    return Response.json({ error: 'drain_failed' }, { status: 500, headers: NO_STORE });
  }
}
