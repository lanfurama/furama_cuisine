'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { tagsForLocales, tagsForSave } from '@/lib/cache-plan';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  addLocale,
  deleteLocale,
  moveLocale,
  saveSocialLocales,
  setLocaleEnabled,
  setServeMachine,
  type LocaleResult,
} from '@/lib/server/content-admin/locales';
import { SOCIAL_LINK } from '@/lib/server/content-admin/socials';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * /admin/locales (spec §8; §7.1: Admin only, locales:update — the CI guard
 * holds this whole file to a permission the Editor lacks). Each write is one
 * transaction with its audit row (lib/server/content-admin/locales.ts), then
 * expires `locales` and the i18n tag of each language it changed
 * (tagsForLocales); the social links' languages expire their table's tags.
 */

const code = z.string().regex(LOCALE_CODE_RE, 'Mã ngôn ngữ không hợp lệ.');
const token = z.string().max(64);
const Target = z.object({ code, token });

/** After a write: expire `locales` and the i18n tag of each language it changed, then redraw this page. */
function finish(result: LocaleResult): ActionResult {
  if (!result.ok) return result;
  for (const tag of tagsForLocales(result.data.changed)) updateTag(tag);
  refresh();
  return { ok: true, data: null };
}

export async function addLanguage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    return finish(await addLocale(getPool(), auditActor(staff), Target.parse(Object.fromEntries(formData))));
  } catch (err) {
    return actionError(err);
  }
}

export async function setLanguageEnabled(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    const input = Target.extend({ enabled: z.enum(['true', 'false']) }).parse(Object.fromEntries(formData));
    return finish(await setLocaleEnabled(getPool(), auditActor(staff), { ...input, enabled: input.enabled === 'true' }));
  } catch (err) {
    return actionError(err);
  }
}

export async function setLanguageServeMachine(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    const input = Target.extend({ on: z.enum(['true', 'false']) }).parse(Object.fromEntries(formData));
    return finish(await setServeMachine(getPool(), auditActor(staff), { ...input, on: input.on === 'true' }));
  } catch (err) {
    return actionError(err);
  }
}

export async function moveLanguage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    const input = Target.extend({ direction: z.enum(['up', 'down']) }).parse(Object.fromEntries(formData));
    return finish(await moveLocale(getPool(), auditActor(staff), input));
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteLanguage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    return finish(await deleteLocale(getPool(), auditActor(staff), Target.parse(Object.fromEntries(formData))));
  } catch (err) {
    return actionError(err);
  }
}

/** Which languages one social link shows in (R39): "all" is NULL, else the ticked codes. */
export async function saveLinkLanguages(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ locales: ['update'] });
    const input = z
      .object({ id: z.string().regex(/^\d+$/), token, scope: z.enum(['all', 'some']), locales: z.array(code).max(30) })
      .parse({ ...Object.fromEntries(formData), locales: formData.getAll('locales') });
    const result = await saveSocialLocales(getPool(), auditActor(staff), input.id, input.token, {
      visibleLocales: input.scope === 'all' ? null : input.locales,
    });
    if (!result.ok) return result;
    for (const tag of tagsForSave(SOCIAL_LINK.tables)) updateTag(tag);
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
