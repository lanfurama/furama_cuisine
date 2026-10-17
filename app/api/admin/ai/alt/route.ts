import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { actionFailureResponse, aiErrorResponse } from '@/lib/server/ai/http';
import { aiRoute } from '@/lib/server/ai/route-guard';
import { describeMediaImage } from '@/lib/server/content-admin/machine-alt';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * "Viết alt bằng AI" on /admin/media/[id] (spec §9.3, R9-12, R9-21): the
 * text for the EN alt box of a picture in Blob. Nothing is saved; staff save
 * the form as always (reviewed). The person's call: their limits apply. A
 * static file, a PDF, a decorative picture or one in the trash is not found
 * (the page shows no button for them).
 */
export const maxDuration = 60;

const Body = z.object({ mediaId: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'] });
    const { settings } = await aiRoute(request, 'alt', staff);
    const { mediaId } = Body.parse(await request.json().catch(() => null));
    const described = await describeMediaImage(getPool(), { mediaId, actorId: staff.userId, settings, signal: request.signal });
    if (!described) return actionFailureResponse({ ok: false, code: 'not_found' });
    return Response.json({ alt: described.alt }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
