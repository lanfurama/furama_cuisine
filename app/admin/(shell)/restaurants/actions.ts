'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPool } from '@/db/client';
import { NewRestaurantForm, readForm, RestaurantOrderForm, RestaurantSwitchForm, RestoreForm } from '@/lib/admin/content-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createRestaurant,
  reorderRestaurants,
  RESTAURANT,
  restoreRestaurantOrder,
  setRestaurantArchived,
  setRestaurantShown,
  type RestaurantResult,
} from '@/lib/server/content-admin/restaurants';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * The restaurants list (spec §7.2 /admin/restaurants), Editor and Admin
 * (content:update; the order's History content:restore): "Thêm nhà hàng"
 * (R22), shown or hidden, archived or back (F10: never deleted), and the
 * catalogue's order. Each is one transaction with its audit row
 * (lib/server/content-admin/restaurants.ts), then updateTag for
 * tagsForSave(<the aggregate's tables>, id) (code rule 1), and the
 * restaurant's booking-rules tag when guests' view of it changed (online
 * booking follows it: bookableSql).
 */

function expire(id: string | null, result?: RestaurantResult) {
  for (const tag of tagsForSave(RESTAURANT.tables, id ?? undefined)) updateTag(tag);
  if (id && result?.ok && result.data.visibilityChanged) updateTag(TAGS.bookingRules(id));
}

export async function createRestaurantAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = NewRestaurantForm.parse(readForm(formData));
    const result = await createRestaurant(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    // A hidden draft: no guest page shows it yet, but the admin lists read the catalogue too.
    expire(result.data.id);
    redirect(`/admin/restaurants/${result.data.id}`);
  } catch (err) {
    return actionError(err);
  }
}

export async function showRestaurantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, value } = RestaurantSwitchForm.parse(readForm(formData));
    const result = await setRestaurantShown(getPool(), auditActor(staff), { id, token, shown: value });
    if (!result.ok) return result;
    expire(id, result);
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function archiveRestaurantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, value } = RestaurantSwitchForm.parse(readForm(formData));
    const result = await setRestaurantArchived(getPool(), auditActor(staff), { id, token, archived: value });
    if (!result.ok) return result;
    expire(id, result);
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderRestaurantsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = RestaurantOrderForm.parse(readForm(formData));
    const result = await reorderRestaurants(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire(null);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreRestaurantOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreRestaurantOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire(null);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
