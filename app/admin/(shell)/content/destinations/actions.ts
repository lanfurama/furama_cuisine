'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { DestinationForm, readForm, RestoreForm, SlugOrderForm, SlugPublishForm, SlugRecordRef } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createDestination,
  deleteDestination,
  DESTINATION,
  reorderDestinations,
  restaurantsAt,
  restoreDestination,
  restoreDestinationOrder,
  setDestinationPublished,
  updateDestination,
} from '@/lib/server/content-admin/destinations';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Điểm đến" (spec §7.2 content/destinations), Editor and Admin: the list
 * (lib/server/content-admin/destinations.ts, a makeListEditor list). Each:
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(destinations, destination_i18n), i.e. content:destinations,
 * after the commit (spec §7.4, code rule 1). That tag is on every loader that
 * reads a destination: the chrome, the catalogue, a restaurant's page and
 * slugs, the offers (L7-2). A write to one destination can change whether
 * guests may book its restaurants (bookableSql), so it also expires their
 * booking-rules tags (outline §4.6). A restore needs content:restore.
 */

async function expire(destinationId?: string) {
  for (const tag of tagsForSave(DESTINATION.tables)) updateTag(tag);
  if (destinationId) for (const id of await restaurantsAt(getPool(), destinationId)) updateTag(TAGS.bookingRules(id));
}

export async function createDestinationAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = DestinationForm.parse(readForm(formData));
    const result = await createDestination(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    await expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveDestinationAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = SlugRecordRef.parse(fields);
    // The id is the record's (SlugRecordRef), never the form's: it cannot be renamed.
    const result = await updateDestination(getPool(), auditActor(staff), id, token, { ...DestinationForm.parse(fields), id });
    if (!result.ok) return result;
    await expire(id);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleDestinationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = SlugPublishForm.parse(readForm(formData));
    const result = await setDestinationPublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    await expire(id);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteDestinationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = SlugRecordRef.parse(readForm(formData));
    const result = await deleteDestination(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    await expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderDestinationsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = SlugOrderForm.parse(readForm(formData));
    const result = await reorderDestinations(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    await expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreDestinationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreDestination(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    await expire(input.id);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreDestinationOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreDestinationOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    await expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
