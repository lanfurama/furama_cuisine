'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { CuisineForm, readForm, RestoreForm, SlugOrderForm, SlugPublishForm, SlugRecordRef } from '@/lib/admin/content-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createCuisine,
  CUISINE,
  deleteCuisine,
  reorderCuisines,
  restoreCuisine,
  restoreCuisineOrder,
  setCuisinePublished,
  updateCuisine,
} from '@/lib/server/content-admin/cuisines';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Ẩm thực" (spec §7.2 content/cuisines), Editor and Admin: the list
 * (lib/server/content-admin/cuisines.ts, a makeListEditor list). Each:
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(cuisines, cuisine_i18n), i.e. content:cuisines, after the
 * commit (spec §7.4, code rule 1): the chrome's rail and filters and the
 * catalogue's cuisine labels carry it. A restore needs content:restore.
 */

function expire() {
  for (const tag of tagsForSave(CUISINE.tables)) updateTag(tag);
}

export async function createCuisineAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = CuisineForm.parse(readForm(formData));
    const result = await createCuisine(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveCuisineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = SlugRecordRef.parse(fields);
    // The id is the record's (SlugRecordRef), never the form's: it cannot be renamed.
    const result = await updateCuisine(getPool(), auditActor(staff), id, token, { ...CuisineForm.parse(fields), id });
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleCuisineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = SlugPublishForm.parse(readForm(formData));
    const result = await setCuisinePublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteCuisineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = SlugRecordRef.parse(readForm(formData));
    const result = await deleteCuisine(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderCuisinesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = SlugOrderForm.parse(readForm(formData));
    const result = await reorderCuisines(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreCuisineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreCuisine(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreCuisineOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreCuisineOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
