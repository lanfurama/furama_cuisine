'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { readForm, RestoreForm, ShareImageForm } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { restoreSettings, saveSettings, SHARE_IMAGE } from '@/lib/server/content-admin/settings';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "SEO" (spec §7.2 content/seo), Editor and Admin: the share picture
 * (site_settings.og_image_id, lib/server/content-admin/settings.ts).
 * requirePermission → zod → one transaction with its audit row (the file
 * checked live, code rule 2) → updateTag for tagsForSave(['site_settings'])
 * after the commit (spec §7.4, code rule 1): every guest page's metadata
 * reads it (content:contact). A restore needs content:restore. The seo.*
 * words are StringsPanel's (strings actions).
 */

function expire() {
  for (const tag of tagsForSave(['site_settings'])) updateTag(tag);
}

export async function saveShareImageAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { token, ogImageId } = ShareImageForm.parse(readForm(formData));
    const result = await saveSettings(getPool(), auditActor(staff), SHARE_IMAGE, { token, values: { og_image_id: ogImageId } });
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreShareImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.parse(readForm(formData));
    const result = await restoreSettings(getPool(), auditActor(staff), SHARE_IMAGE, input);
    if (!result.ok) return result;
    expire();
    return result;
  } catch (err) {
    return actionError(err);
  }
}
