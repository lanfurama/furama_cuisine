'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { NavItemForm, OrderForm, PublishForm, readForm, RecordRef, RestoreForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createNavItem,
  deleteNavItem,
  NAV_ITEM,
  reorderNavItems,
  restoreNavItem,
  restoreNavItemOrder,
  setNavItemPublished,
  updateNavItem,
} from '@/lib/server/content-admin/nav';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Menu điều hướng" (spec §7.2 content/navigation), Editor and Admin: the
 * list (lib/server/content-admin/nav.ts, a makeListEditor list). Each:
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(nav_items, nav_item_i18n), i.e. content:nav, after the
 * commit (spec §7.4, code rule 1): the chrome of every guest page carries
 * it. A restore needs content:restore.
 */

function expire() {
  for (const tag of tagsForSave(NAV_ITEM.tables)) updateTag(tag);
}

export async function createNavItemAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = NavItemForm.parse(readForm(formData));
    const result = await createNavItem(getPool(), auditActor(staff), { ...input, id: null });
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveNavItemAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateNavItem(getPool(), auditActor(staff), id, token, { ...NavItemForm.parse(fields), id });
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleNavItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setNavItemPublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteNavItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteNavItem(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderNavItemsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderNavItems(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreNavItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreNavItem(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreNavItemOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreNavItemOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
