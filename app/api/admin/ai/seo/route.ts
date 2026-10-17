import { z } from '@/lib/admin/zod';
import { getPool } from '@/db/client';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { LISTED_LOCALE_CODES } from '@/lib/i18n/site-locales';
import { actionFailureResponse, aiErrorResponse } from '@/lib/server/ai/http';
import { aiRoute } from '@/lib/server/ai/route-guard';
import { suggestSeo } from '@/lib/server/ai/seo';
import { seoMaterial } from '@/lib/server/content-admin/seo-material';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * "Gợi ý bằng AI" for SEO (spec §9.3, R9-22): a title and a description for
 * the home page or one restaurant, in one listed language (the default one
 * too). The client names the page and the language only: the server reads
 * the page as guests see it (lib/server/content-admin/seo-material.ts).
 * Nothing is saved; the form fills its two boxes and staff press Lưu.
 */
export const maxDuration = 60;

const Body = z.object({
  locale: z.string().regex(LOCALE_CODE_RE),
  target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('home') }), z.object({ kind: z.literal('restaurant'), id: z.string().regex(/^[a-z0-9-]{1,60}$/) })]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'] });
    const { settings } = await aiRoute(request, 'seo', staff);
    const body = Body.parse(await request.json().catch(() => null));
    if (!LISTED_LOCALE_CODES.includes(body.locale)) throw new z.ZodError([]);
    const pool = getPool();
    const material = await seoMaterial(pool, body.target, body.locale);
    if (!material) return actionFailureResponse({ ok: false, code: 'not_found' });
    const suggestion = await suggestSeo(pool, { material, locale: body.locale, actorId: staff.userId, signal: request.signal, settings });
    return Response.json(suggestion, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
