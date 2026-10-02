'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { PeriodsForm, RulesForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import type { Meal } from '@/lib/data';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { saveRestaurantRules, saveServicePeriods } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Giờ và sức chứa" (spec §7.2, §10.1), Editor and Admin: the service periods
 * (schedule:update), and the booking switch with its overrides
 * (reservations:configure). After the commit every save expires the guest's
 * view of the restaurant: 'restaurants' (the cached catalogue: its meals and
 * bookingEnabled) and 'booking-rules:<id>' (spec §10.1; nothing reads under
 * it yet, R2). updateTag also re-renders this page in the same response
 * (node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148).
 */

function expire(restaurantId: string) {
  updateTag(TAGS.restaurants);
  updateTag(TAGS.bookingRules(restaurantId));
}

export async function savePeriods(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = PeriodsForm.parse({ restaurant: formData.get('restaurant'), token: formData.get('token'), periods: formData.get('periods') });
    const result = await saveServicePeriods(getPool(), auditActor(staff), {
      restaurantId: input.restaurant,
      token: input.token,
      periods: input.periods.map((p) => ({ ...p, meal: p.meal as Meal, weekdays: [...new Set(p.weekdays)].sort((a, b) => a - b) })),
    });
    if (!result.ok) return result;
    expire(input.restaurant);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveRules(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['configure'] });
    const input = RulesForm.parse(Object.fromEntries(formData));
    const result = await saveRestaurantRules(getPool(), auditActor(staff), { ...input, restaurantId: input.restaurant });
    if (!result.ok) return result;
    expire(input.restaurant);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
