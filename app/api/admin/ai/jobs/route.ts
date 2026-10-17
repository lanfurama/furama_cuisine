import { after } from 'next/server';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { actionFailureResponse, aiErrorResponse } from '@/lib/server/ai/http';
import { createJob, latestJobs } from '@/lib/server/ai/jobs';
import { aiRoute } from '@/lib/server/ai/route-guard';
import { RUN_BUDGET_MS, runTranslationJobsQuietly } from '@/lib/server/content-admin/machine-translations';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * Bulk translation (spec §9.3, R9-2, R9-24). POST "Dịch tất cả phần còn thiếu
 * bằng AI" for one language: Admin only (spec §8; content:ai plus
 * settings:update, which an Editor lacks; the plan's owner question 2 is
 * still open: loosening is content:['ai'] in the two job routes and the
 * guard's AI_ROUTES table), from this site, not in a preview,
 * with AI on. The job is created, then run in after() within this function's
 * time; whatever is left goes on at the next cron or "Chạy tiếp ngay".
 * GET: the newest job of each language, for the panel's 5-second poll
 * (content:read: an Editor watches, an Admin runs).
 */
export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };
const Body = z.object({ locale: z.string().regex(LOCALE_CODE_RE) });

export async function POST(request: Request): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'], settings: ['update'] });
    await aiRoute(request, 'translate', staff);
    const { locale } = Body.parse(await request.json().catch(() => null));
    const pool = getPool();
    const result = await createJob(pool, auditActor(staff), locale);
    if (!result.ok) return actionFailureResponse(result);
    after(() => runTranslationJobsQuietly(pool, { budgetMs: RUN_BUDGET_MS, ids: [result.data.id] }));
    return Response.json(result, { status: 201, headers: NO_STORE });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

export async function GET(): Promise<Response> {
  try {
    await requirePermission({ content: ['read'] });
    return Response.json({ jobs: await latestJobs(getPool()) }, { headers: NO_STORE });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
