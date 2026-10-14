'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { AI_FEATURES, AiSettingsSchema, GlossaryForm, GlossaryTarget } from '@/lib/admin/ai-schemas';
import { z } from '@/lib/admin/zod';
import type { Saved } from '@/lib/admin/save-state';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { checkConnection, type CheckRow } from '@/lib/server/ai/check';
import { deleteGlossaryEntry, saveGlossaryEntry } from '@/lib/server/ai/glossary';
import { loadAiSettings, saveAiSettings } from '@/lib/server/ai/settings';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Cấu hình AI" (spec §7.1: Admin only, settings:update; the CI guard holds
 * this whole file to a permission the Editor lacks). The glossary saves in one
 * transaction with its audit_log row; the translator reads it live, but the
 * save expires TAGS.aiSettings like every AI setting (spec §9.2).
 */

export async function saveGlossaryAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = GlossaryForm.parse(Object.fromEntries(formData));
    const result = await saveGlossaryEntry(getPool(), auditActor(staff), {
      id: input.id ?? undefined,
      term: input.term,
      mode: input.mode,
      locale: input.locale ?? null,
      target: input.target ?? null,
    });
    if (result.ok) updateTag(TAGS.aiSettings);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteGlossaryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const { id } = GlossaryTarget.parse(Object.fromEntries(formData));
    const result = await deleteGlossaryEntry(getPool(), auditActor(staff), id);
    if (result.ok) updateTag(TAGS.aiSettings);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

const text = (f: FormData, name: string) => (typeof f.get(name) === 'string' ? (f.get(name) as string) : '');
/** A blank or non-numeric box stays the string, which the number check refuses (a blank is not 0). */
const num = (f: FormData, name: string): number | string => {
  const raw = text(f, name);
  const n = Number(raw);
  return raw.trim() === '' || !Number.isFinite(n) ? raw : n;
};

/** The settings form's plain fields (features.seo.model, limits.perDay, …) as the schema's object. */
function readSettings(f: FormData) {
  const features = Object.fromEntries(
    AI_FEATURES.map((k) => [
      k,
      {
        enabled: f.get(`features.${k}.enabled`) === 'on',
        model: text(f, `features.${k}.model`),
        region: text(f, `features.${k}.region`),
        reasoning: text(f, `features.${k}.reasoning`),
        maxOutputTokens: num(f, `features.${k}.maxOutputTokens`),
        systemPrompt: text(f, `features.${k}.systemPrompt`),
      },
    ]),
  );
  return {
    features,
    brandVoice: text(f, 'brandVoice'),
    limits: { perMinute: num(f, 'limits.perMinute'), perDay: num(f, 'limits.perDay') },
    budgetUsd: num(f, 'budgetUsd'),
  };
}

export async function saveAiSettingsAction(_prev: ActionResult<Saved> | null, formData: FormData): Promise<ActionResult<Saved>> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const parsed = AiSettingsSchema.safeParse(readSettings(formData));
    if (!parsed.success) {
      // Keyed by the field's own name (features.seo.region), so each message lands under its box.
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (fieldErrors[issue.path.join('.')] ??= []).push(issue.code === 'invalid_type' && issue.expected === 'number' ? 'Nhập một số.' : issue.message);
      return { ok: false, code: 'invalid', fieldErrors };
    }
    const pool = getPool();
    const result = await saveAiSettings(pool, auditActor(staff), { settings: parsed.data, token: text(formData, 'token') });
    if (!result.ok) return result;
    updateTag(TAGS.aiSettings);
    return { ok: true, data: { token: (await loadAiSettings(pool)).token } };
  } catch (err) {
    return actionError(err);
  }
}

const CheckForm = z.object({ withImage: z.preprocess((v) => v === 'on', z.boolean()) });

/** "Kiểm tra kết nối" (spec §9.2): the only AI call made from a Server Action, bounded to 20 s. */
export async function checkConnectionAction(_prev: ActionResult<{ rows: CheckRow[] }> | null, formData: FormData): Promise<ActionResult<{ rows: CheckRow[] }>> {
  try {
    await requirePermission({ settings: ['update'] });
    const { withImage } = CheckForm.parse(Object.fromEntries(formData));
    const pool = getPool();
    const { settings } = await loadAiSettings(pool);
    return { ok: true, data: { rows: await checkConnection(pool, settings, { deadlineMs: 20_000, withImage }) } };
  } catch (err) {
    return actionError(err);
  }
}
