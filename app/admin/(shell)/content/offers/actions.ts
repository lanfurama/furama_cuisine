'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPool } from '@/db/client';
import { OfferForm, OrderForm, PublishForm, readForm, RecordRef, RestoreForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createOffer,
  deleteOffer,
  OFFER,
  reorderOffers,
  restoreOffer,
  restoreOfferOrder,
  setOfferPublished,
  updateOffer,
} from '@/lib/server/content-admin/offers';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Ưu đãi" (spec §7.2 content/offers), Editor and Admin. Every action:
 * requirePermission → zod → the transaction with its audit row
 * (lib/server/content-admin/offers.ts) → updateTag for each tag of
 * tagsForSave(offers, offer_i18n), i.e. content:offers, after the commit
 * (spec §7.4; code rule 1). updateTag also re-renders this admin page in the same
 * response (node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148),
 * so the form gets its new token. A restore needs content:restore (spec §7.1).
 */

function expire() {
  for (const tag of tagsForSave(OFFER.tables)) updateTag(tag);
}

export async function createOfferAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = OfferForm.parse(readForm(formData));
    const result = await createOffer(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    redirect(`/admin/content/offers/${result.data.id}`);
  } catch (err) {
    return actionError(err);
  }
}

export async function saveOfferAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateOffer(getPool(), auditActor(staff), id, token, OfferForm.parse(fields));
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleOfferAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    // PublishForm, like every list's switch: a value other than '0' or '1' is refused, never read as "hide" (7A fix-wave residual).
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setOfferPublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteOfferAction(_prev: ActionResult<{ unlinked: number }> | null, formData: FormData): Promise<ActionResult<{ unlinked: number }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteOffer(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: { unlinked: (result.data.meta?.unlinked_reservations as string[] | undefined)?.length ?? 0 } };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderOffersAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderOffers(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreOfferAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreOffer(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreOfferOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreOfferOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
