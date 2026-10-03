'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { TAGS } from '@/lib/cache-tags';
import { RecipientForm, RecipientTarget, SharedInboxForm, TestEmailForm } from '@/lib/admin/notification-schemas';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { createRecipient, deleteRecipient, saveSharedInbox, updateRecipient, type RecipientInput } from '@/lib/server/email/recipients';
import { sendTestEmail } from '@/lib/server/email/test-email';
import type { EmailDeliveryMode } from '@/lib/server/email/types';

/*
 * "Thông báo email" (spec §7.1: Admin only, settings:update; the CI guard
 * holds this whole file to a permission the Editor lacks). Recipients and the
 * shared inbox save in one transaction with their audit_log row (spec §7.4).
 * Recipients are not cached: the queue reads them live when it writes
 * staff.new, so there is no tag to expire; refresh() redraws this page. The
 * shared inbox is also the guest site's general email (footer, privacy page),
 * cached under content:contact: saveInbox expires that tag after its commit.
 */

const DUPLICATE = { email: ['Địa chỉ này đã nhận thông báo cho cùng phạm vi.'] };

function recipientInput(formData: FormData): RecipientInput {
  const r = RecipientForm.parse({ ...Object.fromEntries(formData), events: formData.getAll('events') });
  return {
    scope: r.scope,
    destinationId: r.scope === 'destination' ? r.destinationId : null,
    restaurantId: r.scope === 'restaurant' ? r.restaurantId : null,
    email: r.email,
    events: r.events,
    locale: r.locale,
    active: r.active,
  };
}

export async function addRecipient(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const result = await createRecipient(getPool(), auditActor(staff), recipientInput(formData));
    if (!result.ok) return { ok: false, code: 'invalid', fieldErrors: DUPLICATE };
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function editRecipient(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const target = RecipientTarget.parse({ id: formData.get('id'), token: formData.get('token') });
    const result = await updateRecipient(getPool(), auditActor(staff), { ...recipientInput(formData), ...target });
    if (!result.ok) return result.code === 'duplicate' ? { ok: false, code: 'invalid', fieldErrors: DUPLICATE } : result;
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function removeRecipient(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const target = RecipientTarget.parse({ id: formData.get('id'), token: formData.get('token') });
    const result = await deleteRecipient(getPool(), auditActor(staff), target);
    if (!result.ok) return result;
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveInbox(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = SharedInboxForm.parse(Object.fromEntries(formData));
    const result = await saveSharedInbox(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    // The footer and the privacy page print this address (lib/cache-plan.ts SAVE_TAGS.site_settings).
    updateTag(TAGS.contentContact);
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

/**
 * "Gửi email thử" (R9): the sample booking's email, sent and awaited, so the Admin sees at once
 * whether this environment can send. settings:update, not :read: it sends mail to any address typed.
 */
export async function sendTest(
  _prev: ActionResult<{ mode: EmailDeliveryMode; to: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ mode: EmailDeliveryMode; to: string }>> {
  try {
    await requirePermission({ settings: ['update'] });
    const input = TestEmailForm.parse(Object.fromEntries(formData));
    return await sendTestEmail(getPool(), input);
  } catch (err) {
    return actionError(err);
  }
}
