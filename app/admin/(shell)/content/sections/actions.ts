'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { readForm, RestoreForm, SectionForm } from '@/lib/admin/content-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { restoreSection, saveSection } from '@/lib/server/content-admin/sections';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * One home section (spec §7.2 content/sections), Editor and Admin, and the
 * film part of the hero screen, which posts the same form (C5, R23: one
 * writer). requirePermission → zod → the transaction with its audit row
 * (lib/server/content-admin/sections.ts) → updateTag for tagsForSave(sections),
 * i.e. content:sections, which every guest page carries through its layout
 * (phase-6 D2): the switch, the picture and the link reach the next request.
 * updateTag also re-renders this admin page in the same response
 * (node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148).
 * A restore needs content:restore (spec §7.1).
 */

function expire() {
  for (const tag of tagsForSave(['sections'])) updateTag(tag);
}

export async function saveSectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = SectionForm.parse(readForm(formData));
    const result = await saveSection(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreSectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSection(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
