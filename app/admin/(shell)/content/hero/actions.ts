'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { AutoplayForm, OrderForm, PublishForm, readForm, RecordRef, RestoreForm, SlideForm } from '@/lib/admin/content-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createSlide,
  deleteSlide,
  HERO_SLIDE,
  reorderSlides,
  restoreSlide,
  restoreSlideOrder,
  setSlidePublished,
  updateSlide,
} from '@/lib/server/content-admin/hero';
import { restoreAutoplay, saveAutoplay } from '@/lib/server/content-admin/sections';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Hero và phim" (spec §7.2 content/hero), Editor and Admin: the slides
 * (lib/server/content-admin/hero.ts, a makeListEditor list) and the slide
 * pace (site_settings.hero_autoplay_ms). The film part posts the sections
 * screen's action (C5). Each: requirePermission → zod → one transaction with
 * its audit row → updateTag for tagsForSave(<tables written>) after the
 * commit (spec §7.4, code rule 1): content:hero for a slide, content:contact
 * for the pace (the layout's site settings carry it). A restore needs
 * content:restore (spec §7.1).
 */

function expireSlides() {
  for (const tag of tagsForSave(HERO_SLIDE.tables)) updateTag(tag);
}

function expireSettings() {
  for (const tag of tagsForSave(['site_settings'])) updateTag(tag);
}

export async function createSlideAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = SlideForm.parse(readForm(formData));
    const result = await createSlide(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveSlideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateSlide(getPool(), auditActor(staff), id, token, SlideForm.parse(fields));
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleSlideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setSlidePublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteSlideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteSlide(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expireSlides();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderSlidesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderSlides(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreSlideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSlide(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreSlideOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSlideOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expireSlides();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveAutoplayAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, seconds } = AutoplayForm.parse(readForm(formData));
    const result = await saveAutoplay(getPool(), auditActor(staff), { token, ms: seconds * 1000 });
    if (!result.ok) return result;
    expireSettings();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreAutoplayAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreAutoplay(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expireSettings();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
