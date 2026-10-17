import { z } from '@/lib/admin/zod';
import { getPool } from '@/db/client';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { LISTED_LOCALE_CODES } from '@/lib/i18n/site-locales';
import { ASSIST_ACTIONS, assistStream, MAX_ASSIST_CHARS } from '@/lib/server/ai/assist';
import { aiErrorResponse } from '@/lib/server/ai/http';
import { aiRoute } from '@/lib/server/ai/route-guard';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * "Trợ lý viết" (spec §9.3, R9-10, R9-23): rewrite, shorten or put into the
 * brand voice the text a field shows (saved or not), in the language of its
 * tab, streamed back as text/plain. Nothing is saved: the panel fills the box
 * and staff save as always. A refusal, or a failure before the first words,
 * is JSON `{ code, message }` like the translate route. Closing the panel
 * aborts the fetch; the request's signal stops the model call.
 */
export const maxDuration = 60;

const Body = z.object({
  action: z.enum(ASSIST_ACTIONS),
  text: z
    .string()
    .max(MAX_ASSIST_CHARS)
    .refine((t) => t.trim().length > 0),
  // Any listed language, the default one included: the assistant writes in the tab's language.
  locale: z
    .string()
    .regex(LOCALE_CODE_RE)
    .refine((l) => LISTED_LOCALE_CODES.includes(l)),
  // The field's own maximum, passed on to the model as a target; the save checks the real limit.
  maxLength: z.number().int().min(1).max(MAX_ASSIST_CHARS).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'] });
    await aiRoute(request, 'assist', staff);
    const body = Body.parse(await request.json().catch(() => null));
    return await assistStream(getPool(), { ...body, actorId: staff.userId, signal: request.signal });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
