'use server';

import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPool } from '@/db/client';
import { checkbox, readForm, RestoreForm, Token } from '@/lib/admin/content-schemas';
import type { Saved } from '@/lib/admin/save-state';
import { z } from '@/lib/admin/zod';
import { tagsForSave } from '@/lib/cache-plan';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { BlobNotConfiguredError } from '@/lib/server/media/blob';
import { deleteMedia, getMedia, MEDIA, restoreMedia, saveMediaDetails } from '@/lib/server/media/library';
import { registerUploadedMedia } from '@/lib/server/media/register';
import { LOCALE_CODE_RE } from '@/lib/i18n/locales';

/*
 * The media library (spec §7.2 /admin/media; §7.1: content:update, a History
 * restore content:restore; Editor and Admin). Each action: requirePermission,
 * zod, one transaction with its audit row (lib/server/media/library.ts), then
 * the cache tags after the commit.
 *
 * Tags: a file no content uses is on no guest page, so registering one or
 * deleting one (deleteMedia refuses a used file) expires nothing; editing or
 * restoring the alt text or the decorative flag of a used file expires
 * `media` through tagsForSave (code rule 1), which every loader that returns
 * an image carries (lib/cache-plan.ts). An unused file's edit expires nothing:
 * D2 (phase-6 ledger) makes every `media` expiry a re-render of every guest
 * page. refresh() re-renders this admin page when no tag expired
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md:9,13).
 */

const MediaId = z.uuid({ error: 'File không hợp lệ.' });

async function expireIfShown(id: string): Promise<void> {
  const file = await getMedia(getPool(), id);
  // updateTag re-renders this admin page in the same response (node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148).
  if (file && file.uses > 0) for (const tag of tagsForSave(MEDIA.tables)) updateTag(tag);
  else refresh();
}

const Register = z.object({
  pathname: z.string().min(1).max(300),
  alt: z.string().trim().max(250, { error: 'Mô tả ảnh tối đa 250 ký tự.' }).optional(),
  decorative: z.boolean().optional(),
});

/** Upload step 2 (spec §11): called by the uploader once the browser's PUT to Vercel Blob has finished. */
export async function registerMediaAction(input: { pathname: string; alt?: string; decorative?: boolean }): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const parsed = Register.parse(input);
    const result = await registerUploadedMedia(getPool(), auditActor(staff), parsed);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { id: result.data.id } };
  } catch (err) {
    return err instanceof BlobNotConfiguredError ? { ok: false, code: 'blob_not_configured' } : actionError(err);
  }
}

const Details = z.object({
  id: MediaId,
  token: Token,
  alt: z.string().trim().max(250, { error: 'Mô tả ảnh tối đa 250 ký tự.' }),
  decorative: checkbox,
  // Each other language's alt (`altIn.<code>`, phase 8); empty is "use English".
  altIn: z.record(z.string().regex(LOCALE_CODE_RE), z.string().trim().max(250, { error: 'Mô tả ảnh tối đa 250 ký tự.' })).optional(),
});

export async function saveMediaDetailsAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { altIn, ...input } = Details.parse(readForm(formData));
    const result = await saveMediaDetails(getPool(), auditActor(staff), { ...input, translations: altIn });
    if (!result.ok) return result;
    await expireIfShown(input.id);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

const Target = z.object({ id: MediaId, token: Token });

export async function deleteMediaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const target = Target.parse(readForm(formData));
    const result = await deleteMedia(getPool(), auditActor(staff), target);
    if (!result.ok) return result;
    // Back to the library, which says what happened and lists the trash; redirect() passes through actionError.
    redirect('/admin/media?deleted=1');
  } catch (err) {
    return actionError(err);
  }
}

export async function restoreMediaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ content: ['restore'] });
    const input = RestoreForm.extend({ id: MediaId }).parse(readForm(formData));
    const result = await restoreMedia(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    await expireIfShown(input.id);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
