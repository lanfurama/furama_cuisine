'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { ExperienceForm, OrderForm, PublishForm, readForm, RecordRef, RestoreForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createExperience,
  deleteExperience,
  EXPERIENCE,
  reorderExperiences,
  restoreExperience,
  restoreExperienceOrder,
  setExperiencePublished,
  updateExperience,
} from '@/lib/server/content-admin/experiences';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Experiences" (spec §7.2 content/experiences), Editor and Admin: the list
 * (lib/server/content-admin/experiences.ts, a makeListEditor list). Each:
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(experiences, experience_i18n), i.e. content:experiences, after the commit (spec §7.4,
 * code rule 1). Every guest page carries that tag (phase-6 D2: the layout
 * reads the home page's lists). A restore needs content:restore.
 */

function expire() {
  for (const tag of tagsForSave(EXPERIENCE.tables)) updateTag(tag);
}

export async function createExperienceAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = ExperienceForm.parse(readForm(formData));
    const result = await createExperience(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveExperienceAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateExperience(getPool(), auditActor(staff), id, token, ExperienceForm.parse(fields));
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleExperienceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setExperiencePublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteExperienceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteExperience(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderExperiencesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderExperiences(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreExperienceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreExperience(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreExperienceOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreExperienceOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
