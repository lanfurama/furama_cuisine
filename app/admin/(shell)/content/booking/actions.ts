'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { BookingDefaultsForm, readForm, RestoreForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { BOOKING_DEFAULTS, restoreSettings, saveSettings } from '@/lib/server/content-admin/settings';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Đặt bàn" (spec §7.2 content/booking), Editor and Admin: the defaults the
 * booking bar and the finder start on (site_settings, lib/server/content-admin/settings.ts).
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(['site_settings']) after the commit (spec §7.4, code rule
 * 1): every guest page reads the settings (content:contact). A restore needs
 * content:restore. The screen's words are StringsPanel's (strings actions).
 */

function expire() {
  for (const tag of tagsForSave(['site_settings'])) updateTag(tag);
}

export async function saveBookingDefaultsAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, defaultRestaurantId, defaultOccasion } = BookingDefaultsForm.parse(readForm(formData));
    const result = await saveSettings(getPool(), auditActor(staff), BOOKING_DEFAULTS, {
      token,
      values: { default_restaurant_id: defaultRestaurantId, default_occasion: defaultOccasion },
    });
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreBookingDefaultsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSettings(getPool(), auditActor(staff), BOOKING_DEFAULTS, input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
