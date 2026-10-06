'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { tagsForSave } from '@/lib/cache-plan';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { QUEUE_PAGE, reviewTranslations } from '@/lib/server/content-admin/translations';
import { tagsForStrings } from '@/lib/server/content/strings-admin';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * The review queue of /admin/translations (spec §8 "Hàng chờ duyệt"): Editor
 * and Admin (content:update). "Duyệt" (a machine translation), "Vẫn đúng" (an
 * "EN đã đổi" one) and "Duyệt các mục đã chọn" post the same thing: rows as
 * kind|id|locale|token, each checked against its token in one transaction
 * (lib/server/content-admin/translations.ts). Then the tags of what changed:
 * a reviewed row may now reach guests (serve_machine off).
 */

const Item = z
  .string()
  .max(300)
  .transform((raw) => raw.split('|'))
  .pipe(z.tuple([z.string().regex(/^[a-z_:-]+$/), z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/), z.string().regex(LOCALE_CODE_RE), z.string().regex(/^\d{0,20}$/)]))
  .transform(([kind, id, locale, token]) => ({ kind, id, locale, token }));
const Items = z.array(Item).min(1, 'Chọn ít nhất một mục.').max(QUEUE_PAGE, `Mỗi lần duyệt tối đa ${QUEUE_PAGE} mục.`);

export async function reviewQueueItems(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    // A row's own button posts `one` (its row alone); "Duyệt các mục đã chọn" posts the ticked rows.
    const one = formData.get('one');
    const items = Items.parse(one ? [one] : formData.getAll('item'));
    const result = await reviewTranslations(getPool(), auditActor(staff), items);
    if (!result.ok) return result;
    for (const tag of tagsForSave(result.data.tables)) updateTag(tag);
    for (const tag of tagsForStrings(result.data.keys)) updateTag(tag);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
