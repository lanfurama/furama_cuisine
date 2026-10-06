'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { readForm, StringRestoreForm } from '@/lib/admin/content-schemas';
import { z } from '@/lib/admin/zod';
import { DEFAULT_LOCALE, LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { ADMIN_SCREENS } from '@/lib/i18n/registry';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { restoreString, saveStrings, tagsForStrings, type StringsWritten } from '@/lib/server/content/strings-admin';

/*
 * Saving the registry keys of one content screen (spec §7.2, §7.4): Editor
 * and Admin (content:update). Validation, the transaction and the audit rows
 * live in lib/server/content/strings-admin.ts; here the order of §7.4 and,
 * after the commit, updateTag of exactly the tags those keys are cached under
 * (tagsForStrings, code rule 1; updateTag runs in Server Actions only:
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:12,16),
 * so the next guest request renders the new text. refresh() redraws this
 * screen when nothing was tagged (email.* keys, read uncached: R6).
 */

const Screen = z.object({ screen: z.enum(ADMIN_SCREENS), locale: z.string().regex(LOCALE_CODE_RE).default(DEFAULT_LOCALE) });

/** v:<key> = value, o:<key> = the value the form was loaded with, t:<key> = the row's token. */
function fields(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of formData) if (name.startsWith(prefix) && typeof value === 'string') out[name.slice(prefix.length)] = value;
  return out;
}

export async function saveScreenStrings(_prev: ActionResult<StringsWritten> | null, formData: FormData): Promise<ActionResult<StringsWritten>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { screen, locale } = Screen.parse({ screen: formData.get('screen'), locale: formData.get('locale') ?? undefined });
    const result = await saveStrings(getPool(), auditActor(staff), {
      screen,
      locale,
      values: fields(formData, 'v:'),
      originals: fields(formData, 'o:'),
      tokens: fields(formData, 't:'),
    });
    if (!result.ok) return result;
    for (const tag of tagsForStrings(result.data.changed, result.data.policyChanged)) updateTag(tag);
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

/** "Khôi phục phiên bản này" of one key (spec §7.5): content:restore, then the same tags as a save. */
export async function restoreScreenString(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const { id, ...input } = StringRestoreForm.parse(readForm(formData));
    const result = await restoreString(getPool(), auditActor(staff), { key: id, ...input });
    if (!result.ok) return result;
    for (const tag of tagsForStrings(result.data.changed, result.data.policyChanged)) updateTag(tag);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
