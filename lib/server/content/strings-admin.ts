import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { TAGS } from '@/lib/cache-tags';
import { checkMessage, describeProblem } from '@/lib/i18n/icu';
import { REGISTRY, isStringKey, keysForScreen, type AdminScreen, type StringDef, type StringKey } from '@/lib/i18n/registry';
import { PRIVACY_KEYS } from '@/lib/legal';
import { insertAudit, withTransaction, type AuditActor } from '../audit';
import { US, conflictBy, type Conflict } from '../booking/config';

/*
 * The content_strings editor (spec §7.2 screens that edit registry keys,
 * §7.3 TranslatableField with only EN until phase 8, §7.4 save flow). Phase 7
 * edits the default language; each key keeps its own row and token, so two
 * editors on one screen conflict only when they touch the same key.
 *
 * A value equal to the registry's English default deletes the row instead of
 * storing a copy: "Khôi phục mặc định" is a plain save, and a later code
 * change to that default reaches the site.
 */

type Db = Pool | PoolClient;
const LOCALE = 'en';

export type StringField = {
  key: StringKey;
  /** What the guest sees now: the row, else the registry default. */
  value: string;
  def: StringDef;
  /** A row exists (the text differs from the default). */
  overridden: boolean;
  /** US(updated_at) of the row, '' when none: the conflict check's token. */
  token: string;
};

export async function loadScreenStrings(db: Db, screen: AdminScreen): Promise<StringField[]> {
  const keys = keysForScreen(screen);
  const { rows } = await db.query<{ key: string; value: string; token: string }>(
    `SELECT key, value, ${US('updated_at')} AS token FROM content_strings WHERE locale = $1 AND key = ANY($2::text[])`,
    [LOCALE, keys],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map((key) => {
    const row = byKey.get(key);
    const def: StringDef = REGISTRY[key];
    return { key, value: row?.value ?? def.en, def, overridden: !!row, token: row?.token ?? '' };
  });
}

/**
 * values: what the form holds; originals: what it was loaded with (so a field
 * this editor left alone is skipped, never written back over a colleague's
 * newer text); tokens: the row versions it was loaded with.
 */
export type StringsInput = {
  screen: AdminScreen;
  values: Partial<Record<string, string>>;
  originals: Partial<Record<string, string>>;
  tokens: Partial<Record<string, string>>;
};
export type StringsSaved = { changed: StringKey[] };
type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };

/** The field name of a key in the form, and of its error in fieldErrors. */
export const fieldName = (key: string) => `v:${key}`;
export const tokenName = (key: string) => `t:${key}`;
export const originalName = (key: string) => `o:${key}`;

const normalise = (raw: string) => raw.replace(/\r\n?/g, '\n').trim();

/** Spec §7.4 checks of one English value against its registry entry (length, ICU, variables). */
export function validateValue(key: StringKey, value: string): string[] {
  const def: StringDef = REGISTRY[key];
  if (value.trim() === '') return ['Không được để trống. Muốn dùng chữ mặc định thì bấm “Khôi phục mặc định”.'];
  const errors: string[] = [];
  if ([...value].length > def.maxLength) errors.push(`Tối đa ${def.maxLength} ký tự (đang có ${[...value].length}).`);
  errors.push(...checkMessage(value, def.vars ?? []).map(describeProblem));
  return errors;
}

/** Validates every submitted key of the screen, then, in one transaction, writes the changed ones with their audit rows. */
export async function saveStrings(pool: Pool, actor: AuditActor, input: StringsInput): Promise<{ ok: true; data: StringsSaved } | Invalid | Conflict> {
  const allowed = new Set<string>(keysForScreen(input.screen));
  const fieldErrors: Record<string, string[]> = {};
  const submitted: [StringKey, string][] = [];
  for (const [key, raw] of Object.entries(input.values)) {
    // A key of another screen is a forged form: refuse it rather than write past this screen's permission story.
    if (!isStringKey(key) || !allowed.has(key) || typeof raw !== 'string') {
      fieldErrors[fieldName(key)] = ['Khóa không thuộc màn hình này.'];
      continue;
    }
    // Line breaks normalised: a textarea posts CRLF.
    const value = normalise(raw);
    // Untouched by this editor: nothing to save, whatever the database holds now.
    if (value === normalise(input.originals[key] ?? '')) continue;
    const errors = validateValue(key, value);
    if (errors.length) fieldErrors[fieldName(key)] = errors;
    else submitted.push([key, value]);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, code: 'invalid', fieldErrors };

  return withTransaction(pool, async (client) => {
    const changed: StringKey[] = [];
    for (const [key, value] of submitted) {
      // Serialises saves of one key even while it has no row to lock (FOR UPDATE locks nothing then).
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('content_strings:' || $1))`, [key]);
      const { rows } = await client.query<{ value: string; token: string; updated_by: string | null; updated_at: Date }>(
        `SELECT value, ${US('updated_at')} AS token, updated_by, updated_at FROM content_strings WHERE key = $1 AND locale = $2`,
        [key, LOCALE],
      );
      const row = rows[0];
      const before = row?.value ?? REGISTRY[key].en;
      if (before === value) continue;
      if ((row?.token ?? '') !== (input.tokens[key] ?? '')) {
        return row ? conflictBy(client, row.updated_by, row.updated_at) : conflictBy(client, null, new Date());
      }
      const toDefault = value === REGISTRY[key].en;
      if (toDefault) {
        await client.query('DELETE FROM content_strings WHERE key = $1 AND locale = $2', [key, LOCALE]);
      } else {
        await client.query(
          `INSERT INTO content_strings (key, locale, value, status, origin, reviewed_by, reviewed_at, updated_at, updated_by)
           VALUES ($1, $2, $3, 'reviewed', 'human', $4, now(), now(), $4)
           ON CONFLICT (key, locale) DO UPDATE
             SET value = EXCLUDED.value, status = 'reviewed', origin = 'human', ai_model = NULL,
                 reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [key, LOCALE, value, actor.id],
        );
      }
      // History (spec §7.5): the whole state either side, so "Khôi phục phiên bản này" can put it back.
      await insertAudit(client, actor, {
        action: !row ? 'create' : toDefault ? 'delete' : 'update',
        entityType: 'content_strings',
        entityId: key,
        locale: LOCALE,
        before: { value: before, overridden: !!row },
        after: { value, overridden: !toDefault },
      });
      changed.push(key);
    }
    return { ok: true, data: { changed } } as const;
  });
}

/**
 * The tags a save of `keys` expires (spec §6.2; phase-6 ledger L7-6: one
 * place, like tagsForSave). The guest reads strings through two cached
 * loaders: getPrivacyStrings (content:legal) for the policy page's own keys,
 * getStrings (content:ui) for every other key a page or the chrome shows.
 * email.* keys are read uncached by the email sender: no tag (R6).
 */
export function tagsForStrings(keys: readonly StringKey[]): string[] {
  const tags = new Set<string>();
  for (const key of keys) {
    if (key.startsWith('email.')) continue;
    tags.add((PRIVACY_KEYS as readonly string[]).includes(key) ? TAGS.contentLegal : TAGS.contentUi);
  }
  return [...tags];
}
