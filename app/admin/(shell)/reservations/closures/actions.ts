'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { ClosureForm, Id, Token } from '@/lib/admin/booking-schemas';
import { z } from '@/lib/admin/zod';
import { TAGS } from '@/lib/cache-tags';
import type { Meal } from '@/lib/data';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { createClosure, deleteClosure, restaurantsInScope, updateClosure, type ClosureInput, type ClosureScope } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * Closures (spec §10.1; §7.1: Editor and Admin, schedule:update): one
 * transaction with its audit_log row, then the booking-rules tag of every
 * restaurant the closure reaches, before an edit and after it. Bookings
 * already made are never touched here: the page lists them, and staff choose.
 */

function closureInput(formData: FormData): ClosureInput {
  const c = ClosureForm.parse({ ...Object.fromEntries(formData), meals: formData.getAll('meals') });
  return {
    scope: c.scope,
    destinationId: c.scope === 'destination' ? c.destinationId : null,
    restaurantId: c.scope === 'restaurant' ? c.restaurantId : null,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    // No meal ticked: the whole day.
    meals: c.meals.length ? (c.meals as Meal[]) : null,
    showReason: c.showReason,
    // The phase-4 form has an English and a Vietnamese field; a reason in another language is kept as it is
    // (writeReasons writes only the languages posted, phase 8 C8).
    publicReason: { ...(c.reasonEn ? { en: c.reasonEn } : {}), ...(c.reasonVi ? { vi: c.reasonVi } : {}) },
    internalNote: c.internalNote,
  };
}

/** The scope the closure had when the page was drawn: an edit changes those restaurants' rules too. */
const Was = z.object({
  scope: z.enum(['all', 'destination', 'restaurant']),
  destinationId: z.string().max(64).nullable(),
  restaurantId: z.string().max(64).nullable(),
});
const was = (formData: FormData): ClosureScope =>
  Was.parse({ scope: formData.get('was_scope'), destinationId: formData.get('was_destination') || null, restaurantId: formData.get('was_restaurant') || null });

const Target = z.object({ id: Id, token: Token });

/** Expires booking-rules:<id> of every restaurant the scopes reach, and re-renders this page (admin data is never cached). */
async function expireRules(scopes: ClosureScope[]) {
  const pool = getPool();
  const ids = new Set((await Promise.all(scopes.map((s) => restaurantsInScope(pool, s)))).flat());
  for (const id of ids) updateTag(TAGS.bookingRules(id));
  refresh();
}

export async function addClosure(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = closureInput(formData);
    const result = await createClosure(getPool(), auditActor(staff), input);
    await expireRules([input]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function editClosure(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = closureInput(formData);
    const target = Target.parse({ id: formData.get('id'), token: formData.get('token') });
    const before = was(formData);
    const result = await updateClosure(getPool(), auditActor(staff), { ...input, ...target });
    if (!result.ok) return result;
    await expireRules([before, input]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function removeClosure(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const target = Target.parse({ id: formData.get('id'), token: formData.get('token') });
    const before = was(formData);
    const result = await deleteClosure(getPool(), auditActor(staff), target);
    if (!result.ok) return result;
    await expireRules([before]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
