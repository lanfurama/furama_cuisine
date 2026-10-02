'use server';

import { refresh } from 'next/cache';
import { getPool } from '@/db/client';
import { EditForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
import type { ReservationStatus } from '@/lib/booking/rules';
import { toE164 } from '@/lib/phone';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { addReservationNote, editReservation, staffActor, transitionReservation } from '@/lib/server/booking/reservations';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * Reservation actions (spec §7.4 for bookings): requirePermission → zod → one
 * transaction (the change and its reservation_events row, never audit_log) →
 * refresh() → ActionResult. Editor and Admin alike (spec §7.1). Reservations
 * are never cached, so there is no tag to expire; refresh() re-renders the
 * page in the same response. No email yet: notifyGuest stays false until
 * phase 5 adds the checkbox and the outbox.
 */

const field = (formData: FormData, name: string) => formData.get(name) ?? undefined;

export async function changeStatus(
  _prev: ActionResult<{ status: ReservationStatus }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: ReservationStatus }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = TransitionForm.parse({
      id: field(formData, 'id'),
      version: field(formData, 'version'),
      to: field(formData, 'to'),
      reason: field(formData, 'reason'),
    });
    const result = await transitionReservation(getPool(), staffActor(staff), { ...input, notifyGuest: false });
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { status: result.data.status } };
  } catch (err) {
    return actionError(err);
  }
}

export async function updateReservation(_prev: ActionResult<{ changed: boolean }> | null, formData: FormData): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = EditForm.parse(Object.fromEntries(formData));
    // EditForm already refused a phone toE164 cannot read.
    const result = await editReservation(getPool(), staffActor(staff), { ...input, phoneE164: toE164(input.phone)! });
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { changed: result.data.changed } };
  } catch (err) {
    return actionError(err);
  }
}

export async function addNote(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['note'] });
    const input = NoteForm.parse({ id: field(formData, 'id'), body: field(formData, 'body') });
    const result = await addReservationNote(getPool(), staffActor(staff), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
