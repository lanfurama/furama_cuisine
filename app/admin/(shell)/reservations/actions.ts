'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPool } from '@/db/client';
import { CancelManyForm, EditForm, NewReservationForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
import type { ReservationStatus } from '@/lib/booking/rules';
import { toE164 } from '@/lib/phone';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { saveInboxSearch, searchText } from '@/lib/server/booking/inbox-search';
import { listGuestContacts, listLocales, type GuestContact } from '@/lib/server/booking/queries';
import { drainAfterCommit } from '@/lib/server/email/after-commit';
import { sittingAhead } from '@/lib/server/email/drain';
import { outboxEffects } from '@/lib/server/email/outbox';
import {
  addReservationNote,
  createStaffReservation,
  editReservation,
  staffActor,
  transitionReservation,
} from '@/lib/server/booking/reservations';
import { refuseVoidAction, requirePermission } from '@/lib/server/dal/session';

/*
 * Reservation actions (spec §7.4 for bookings): requirePermission → zod → one
 * transaction (the change and its reservation_events row, never audit_log) →
 * refresh() → ActionResult. Editor and Admin alike (spec §7.1). Reservations
 * are never cached, so there is no tag to expire; refresh() re-renders the
 * page in the same response. A change that emails the guest queues its
 * email_outbox rows in the same transaction (outboxEffects, spec §10.3–10.4),
 * and drainAfterCommit sends them once it has committed (R20). What staff are
 * told about that email follows the sender, not the queue: a row queued for a
 * sitting that has started is skipped, never sent (F5, sittingAhead).
 */

const field = (formData: FormData, name: string) => formData.get(name) ?? undefined;

/** The status a change reached, and whether a guest email is on its way: the panel's notice says both. */
export type StatusChange = { status: ReservationStatus; emailed: boolean };

export async function changeStatus(_prev: ActionResult<StatusChange> | null, formData: FormData): Promise<ActionResult<StatusChange>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = TransitionForm.parse({
      id: field(formData, 'id'),
      version: field(formData, 'version'),
      to: field(formData, 'to'),
      reason: field(formData, 'reason'),
      notifyGuest: field(formData, 'notifyGuest'),
    });
    const effects = outboxEffects();
    const result = await transitionReservation(getPool(), staffActor(staff), input, { effects });
    if (!result.ok) return result;
    drainAfterCommit(effects.queued);
    refresh();
    // Queued is not enough: the sender skips a booking email once its sitting has started (F5), so the
    // notice promises one only while the sitting is still ahead, by the sender's own rule.
    return { ok: true, data: { status: result.data.status, emailed: effects.queued.length > 0 && sittingAhead(result.data) } };
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

/** A phone booking or a walk-in; on success, the new booking's page. */
export async function createReservation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['create'] });
    const input = NewReservationForm.parse(Object.fromEntries(formData));
    const pool = getPool();
    if (!(await listLocales(pool)).some((l) => l.code === input.locale)) {
      return { ok: false, code: 'invalid', fieldErrors: { locale: ['Chọn ngôn ngữ của khách.'] } };
    }
    const effects = outboxEffects();
    const result = await createStaffReservation(
      pool,
      staffActor(staff),
      {
        restaurantId: input.restaurant,
        date: input.date,
        time: input.time,
        guests: input.guests,
        name: input.name,
        phone: input.phone,
        phoneE164: toE164(input.phone)!,
        email: input.email,
        note: input.note,
        locale: input.locale,
        source: input.source,
        overCapacityReason: input.overCapacityReason,
        notifyGuest: input.notifyGuest,
      },
      { effects },
    );
    if (!result.ok) return result;
    // Before redirect(), which throws: after() is only scheduled once the booking has committed.
    drainAfterCommit(effects.queued);
    // redirect() throws NEXT_REDIRECT, which actionError() rethrows (unstable_rethrow): it may sit in the try (R13).
    redirect(`/admin/reservations/${result.data.id}`);
  } catch (err) {
    return actionError(err);
  }
}

/**
 * `notTold`: the cancelled guests no email goes to (none on file, an unusable one, the box unticked, or
 * a sitting that started after the list was drawn): staff phone them.
 */
export type CancelManyResult = { cancelled: number; skipped: number; notTold: GuestContact[] };

/**
 * "Hủy các đặt bàn đã chọn" under an affected list (spec §10.1): only what
 * staff ticked, never automatic. Each booking is its own transition (its own
 * transaction and event); one that changed since the list was drawn (its
 * version) is skipped and counted, never forced. The answer names the guests
 * who were not emailed, with their numbers: refresh() takes the cancelled rows
 * off the list, so the notice is the only place left to find them.
 */
export async function cancelReservations(_prev: ActionResult<CancelManyResult> | null, formData: FormData): Promise<ActionResult<CancelManyResult>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = CancelManyForm.parse({ items: formData.getAll('item'), reason: field(formData, 'reason'), notifyGuest: field(formData, 'notifyGuest') });
    const pool = getPool();
    const actor = staffActor(staff);
    const effects = outboxEffects();
    let cancelled = 0;
    const untold: string[] = [];
    try {
      for (const item of input.items) {
        const [id, version] = item.split(':');
        const queuedBefore = effects.queued.length;
        const result = await transitionReservation(
          pool,
          actor,
          { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: input.notifyGuest },
          { effects },
        );
        if (!result.ok) continue;
        cancelled += 1;
        // What was queued, not whether an email is on file: the outbox also drops an address it cannot use,
        // and an unticked box queues nothing for anyone. A row queued once the sitting has started is skipped
        // by the sender (F5), so that guest is not told either.
        if (effects.queued.length === queuedBefore || !sittingAhead(result.data)) untold.push(id);
      }
    } finally {
      // Each cancel commits on its own: a throw halfway still sends the emails of those that did (R20).
      if (effects.queued.length > 0) drainAfterCommit(effects.queued);
    }
    const notTold = await listGuestContacts(pool, untold);
    refresh();
    return { ok: true, data: { cancelled, skipped: input.items.length - cancelled, notTold } };
  } catch (err) {
    return actionError(err);
  }
}

/**
 * The inbox search box (spec §7.2). A POST, so the guest's phone, name or
 * email never reaches the URL (phase-4 ruling SEC-2, R18): the text waits in a
 * short-lived httpOnly cookie and the inbox URL carries only its id. A void
 * action has no state to answer in, so a refused caller is sent where a page
 * would send them (sign-in, or the 403 view), never to the error page (T12.4).
 */
export async function searchReservations(formData: FormData): Promise<void> {
  try {
    await requirePermission({ reservations: ['read'] });
  } catch (err) {
    return refuseVoidAction(err, '/admin/reservations');
  }
  const q = searchText(formData.get('q'));
  redirect(q ? `/admin/reservations?tim=${await saveInboxSearch(q)}` : '/admin/reservations');
}
