'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { SettingsForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { listRestaurantBookings, saveBookingSettings } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Cài đặt đặt bàn" (spec §7.1: Admin only, settings:update; the CI guard
 * holds this whole file to a permission the Editor lacks). The defaults reach
 * every restaurant without an override, so every booking-rules tag expires;
 * the catalogue ('restaurants') carries none of them.
 */
export async function saveSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = SettingsForm.parse(Object.fromEntries(formData));
    const pool = getPool();
    const result = await saveBookingSettings(pool, auditActor(staff), input);
    if (!result.ok) return result;
    for (const r of await listRestaurantBookings(pool)) updateTag(TAGS.bookingRules(r.id));
    return result;
  } catch (err) {
    return actionError(err);
  }
}
