import { z } from '@/lib/admin/zod';
import { getPool } from '@/db/client';
import { DEFAULT_LOCALE, LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { REGISTRY, type StringKey } from '@/lib/i18n/registry';
import { aiErrorResponse } from '@/lib/server/ai/http';
import { aiRoute } from '@/lib/server/ai/route-guard';
import { MAX_CHARS, MAX_ITEMS, translateItems, type TranslateItem } from '@/lib/server/ai/translate';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * "Dịch từ EN" (spec §9.3, R9-8): translate the English text a form shows into
 * one language. Nothing is saved; the form fills the box and staff save as
 * always. A registry `key` makes the server take the context, maximum length
 * and variables from the registry, never from the client.
 */
export const maxDuration = 60;

const Body = z.object({
  locale: z.string().regex(LOCALE_CODE_RE).refine((l) => l !== DEFAULT_LOCALE),
  items: z
    .array(z.object({ id: z.string().min(1).max(100), text: z.string().min(1).max(MAX_CHARS), key: z.string().max(120).optional() }))
    .min(1)
    .max(MAX_ITEMS),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const staff = await requirePermission({ content: ['ai'] });
    await aiRoute(request, 'translate', staff);
    const body = Body.parse(await request.json().catch(() => null));
    if (body.items.reduce((n, i) => n + i.text.length, 0) > MAX_CHARS) throw new z.ZodError([]);
    const pool = getPool();
    const known = await pool.query(`SELECT 1 FROM locales WHERE code = $1 AND NOT is_default`, [body.locale]);
    if (known.rowCount === 0) throw new z.ZodError([]);
    const items = body.items.map((i): TranslateItem => {
      if (i.key === undefined) return { id: i.id, text: i.text };
      if (!Object.hasOwn(REGISTRY, i.key)) throw new z.ZodError([]);
      const def = REGISTRY[i.key as StringKey] as { context: string; maxLength: number; vars?: readonly string[] };
      return { id: i.id, text: i.text, context: def.context, maxLength: def.maxLength, vars: def.vars ?? [] };
    });
    const { results } = await translateItems(pool, { items, locale: body.locale, actorId: staff.userId, signal: request.signal });
    return Response.json({ results }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
