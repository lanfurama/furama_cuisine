'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { readForm, RestaurantForm, RestoreForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave, type ContentTable } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { RESTAURANT, restoreRestaurant, saveRestaurantContent, type RestaurantSaved } from '@/lib/server/content-admin/restaurants';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * A restaurant's content (spec §7.2 /admin/restaurants/[id]), Editor and
 * Admin: requirePermission → zod → one transaction for the row, its
 * restaurant_i18n rows, cuisines and highlights, with its audit row → then
 * updateTag for tagsForSave(those tables, id): `restaurants` and
 * `restaurant:<id>` (code rule 1, L7-6). R19 moving the card's alt adds
 * `media` (tagsForSave of media_i18n); a change of visibility adds
 * `booking-rules:<id>` (bookingEnabled reads is_published).
 */

function expire(id: string, saved: RestaurantSaved) {
  const tables: ContentTable[] = [...RESTAURANT.tables, ...(saved.altChanged ? (['media_i18n'] as const) : [])];
  for (const tag of tagsForSave(tables, id)) updateTag(tag);
  if (saved.visibilityChanged) updateTag(TAGS.bookingRules(id));
}

const restaurantId = (formData: FormData) => {
  const id = formData.get('id');
  return typeof id === 'string' && /^[a-z0-9-]{1,60}$/.test(id) ? id : '';
};

export async function saveRestaurantAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const id = restaurantId(formData);
    const { token, ...input } = RestaurantForm.parse(readForm(formData));
    const result = await saveRestaurantContent(getPool(), auditActor(staff), id, token, input);
    if (!result.ok) return result;
    expire(id, result.data);
    return { ok: true, data: { token: result.data.token } };
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreRestaurantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreRestaurant(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire(input.id, result.data);
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
