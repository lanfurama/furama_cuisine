'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { AutoConfirmForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { saveAutoConfirm } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * auto_confirm per restaurant: Admin only (spec §7.1). A file of its own, so
 * the CI guard holds every action in it to a permission the Editor lacks
 * (test/guards/require-permission.guard.test.ts, ADMIN_ONLY_ACTIONS).
 */
export async function saveAutoConfirmSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['auto-confirm'] });
    const input = AutoConfirmForm.parse(Object.fromEntries(formData));
    const result = await saveAutoConfirm(getPool(), auditActor(staff), { restaurantId: input.restaurant, token: input.token, autoConfirm: input.autoConfirm });
    if (!result.ok) return result;
    // The catalogue does not carry auto_confirm; only this restaurant's rules changed (spec §10.1).
    updateTag(TAGS.bookingRules(input.restaurant));
    return result;
  } catch (err) {
    return actionError(err);
  }
}
