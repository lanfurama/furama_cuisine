import { after } from 'next/server';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { actionFailureResponse, aiErrorResponse } from '@/lib/server/ai/http';
import { cancelJob, resumeJob } from '@/lib/server/ai/jobs';
import { aiRoute, assertSameOrigin } from '@/lib/server/ai/route-guard';
import { RUN_BUDGET_MS, runTranslationJobsQuietly } from '@/lib/server/content-admin/machine-translations';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * One job's buttons (spec §9.3, R9-16), Admin only like creating it:
 * `resume` is "Tiếp tục" (a paused job) and "Chạy tiếp ngay" (a queued one,
 * waiting for the next run): the job is queued and run in after(), so AI must
 * be on. `cancel` is "Hủy", which calls no model: it only needs this site's origin.
 */
export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };
const Body = z.object({ action: z.enum(['resume', 'cancel']) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'], settings: ['update'] });
    const { id } = await params;
    assertSameOrigin(request);
    const { action } = Body.parse(await request.json().catch(() => null));
    const pool = getPool();
    if (action === 'cancel') {
      const result = await cancelJob(pool, auditActor(staff), id);
      return result.ok ? Response.json(result, { headers: NO_STORE }) : actionFailureResponse(result);
    }
    await aiRoute(request, 'translate', staff);
    const result = await resumeJob(pool, auditActor(staff), id);
    if (!result.ok) return actionFailureResponse(result);
    after(() => runTranslationJobsQuietly(pool, { budgetMs: RUN_BUDGET_MS, ids: [id] }));
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
