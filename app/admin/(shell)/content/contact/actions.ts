'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { OrderForm, PublishForm, readForm, RecordRef, RestoreForm, SocialForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createSocialLink,
  deleteSocialLink,
  reorderSocialLinks,
  restoreSocialLink,
  restoreSocialLinkOrder,
  setSocialLinkPublished,
  SOCIAL_LINK,
  updateSocialLink,
} from '@/lib/server/content-admin/socials';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Liên hệ và chân trang" (spec §7.2 content/contact), Editor and Admin: the
 * footer's social links (lib/server/content-admin/socials.ts, a
 * makeListEditor list). Each: requirePermission → zod → one transaction with
 * its audit row → updateTag for tagsForSave(social_links), i.e.
 * content:contact, after the commit (spec §7.4, code rule 1): the footer of
 * every guest page carries it. A restore needs content:restore. The shared
 * email is not here (R10: Admin's "Thông báo email").
 */

function expire() {
  for (const tag of tagsForSave(SOCIAL_LINK.tables)) updateTag(tag);
}

export async function createSocialLinkAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = SocialForm.parse(readForm(formData));
    const result = await createSocialLink(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveSocialLinkAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateSocialLink(getPool(), auditActor(staff), id, token, SocialForm.parse(fields));
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleSocialLinkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setSocialLinkPublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteSocialLinkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteSocialLink(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderSocialLinksAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderSocialLinks(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreSocialLinkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSocialLink(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreSocialLinkOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSocialLinkOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
