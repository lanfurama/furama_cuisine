'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { GlossaryForm, GlossaryTarget } from '@/lib/admin/ai-schemas';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { deleteGlossaryEntry, saveGlossaryEntry } from '@/lib/server/ai/glossary';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Cấu hình AI" (spec §7.1: Admin only, settings:update; the CI guard holds
 * this whole file to a permission the Editor lacks). The glossary saves in one
 * transaction with its audit_log row; the translator reads it live, but the
 * save expires TAGS.aiSettings like every AI setting (spec §9.2).
 */

export async function saveGlossaryAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = GlossaryForm.parse(Object.fromEntries(formData));
    const result = await saveGlossaryEntry(getPool(), auditActor(staff), {
      id: input.id ?? undefined,
      term: input.term,
      mode: input.mode,
      locale: input.locale ?? null,
      target: input.target ?? null,
    });
    if (result.ok) updateTag(TAGS.aiSettings);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteGlossaryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const { id } = GlossaryTarget.parse(Object.fromEntries(formData));
    const result = await deleteGlossaryEntry(getPool(), auditActor(staff), id);
    if (result.ok) updateTag(TAGS.aiSettings);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
