'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { OrderForm, PublishForm, readForm, RecordRef, RestoreForm, StoryForm } from '@/lib/admin/content-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import {
  createStory,
  deleteStory,
  reorderStories,
  restoreStory,
  restoreStoryOrder,
  setStoryPublished,
  STORY,
  updateStory,
} from '@/lib/server/content-admin/stories';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Stories" (spec §7.2 content/stories), Editor and Admin: the list
 * (lib/server/content-admin/stories.ts, a makeListEditor list). Each:
 * requirePermission → zod → one transaction with its audit row → updateTag
 * for tagsForSave(stories, story_i18n), i.e. content:stories, after the commit (spec §7.4,
 * code rule 1). Every guest page carries that tag (phase-6 D2: the layout
 * reads the home page's lists). A restore needs content:restore.
 */

function expire() {
  for (const tag of tagsForSave(STORY.tables)) updateTag(tag);
}

export async function createStoryAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const input = StoryForm.parse(readForm(formData));
    const result = await createStory(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveStoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const fields = readForm(formData);
    const { id, token } = RecordRef.parse(fields);
    const result = await updateStory(getPool(), auditActor(staff), id, token, StoryForm.parse(fields));
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function toggleStoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token, publish } = PublishForm.parse(readForm(formData));
    const result = await setStoryPublished(getPool(), auditActor(staff), id, token, publish);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteStoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { id, token } = RecordRef.parse(readForm(formData));
    const result = await deleteStory(getPool(), auditActor(staff), id, token);
    if (!result.ok) return result;
    expire();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function reorderStoriesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, order } = OrderForm.parse(readForm(formData));
    const result = await reorderStories(getPool(), auditActor(staff), token, order);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreStoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreStory(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreStoryOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreStoryOrder(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
