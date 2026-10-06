import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { TAGS } from '@/lib/cache-tags';
import { checkMessage, describeProblem, messageArgs } from '@/lib/i18n/icu';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { REGISTRY, isStringKey, keysForScreen, registryLocaleDefault, type AdminScreen, type StringDef, type StringKey } from '@/lib/i18n/registry';
import { sourceHash, translationState, type TranslationState } from '@/lib/i18n/source-hash';
import { AGREED_KEYS, PRIVACY_KEYS } from '@/lib/legal';
import { insertAudit, withTransaction, type AuditActor } from '../audit';
import { getAuditRow, HISTORY_LIMIT, type HistoryEntry } from '../content-admin/history';
import { US, conflictFromHistory, type Conflict } from '../booking/config';
import { policyWritesRefused, recordPolicyVersions } from './policy-version';

/*
 * The content_strings editor (spec §7.2 screens that edit registry keys,
 * §7.3, §7.4 save flow), one language at a time (phase 8: the screen's
 * ?lang=). Each key keeps its own row and token per language, so two editors
 * on one screen conflict only when they touch the same key in the same
 * language.
 *
 * A key's default in a language is the registry's text for it: English for
 * the default language, the registry's Vietnamese for email.* and legal.* in
 * vi, else nothing (the guest reads English). A value equal to that default
 * deletes the row instead of storing a copy: "Khôi phục mặc định" is a plain
 * save, a later code change to the default reaches the site, and an emptied
 * translation goes back to English.
 */

type Db = Pool | PoolClient;

/** What a key shows in `locale` while it has no row there. */
export function stringDefault(key: StringKey, locale: string): string {
  return locale === DEFAULT_LOCALE ? REGISTRY[key].en : (registryLocaleDefault(key, locale) ?? '');
}

/** The fingerprint a translation of `key` is checked against: the English text guests read now (the row, else the registry). */
export function stringSource(english: string): string {
  return sourceHash(['value'], { value: english });
}

export type StringField = {
  key: StringKey;
  /** What the form starts with: the row, else the language's default ('' when the guest reads English). */
  value: string;
  def: StringDef;
  /** A row exists in this language (the text differs from the default). */
  overridden: boolean;
  /** US(updated_at) of the row, '' when none: the conflict check's token. */
  token: string;
  /** The English text guests read now: a translation's reference and placeholder. */
  english: string;
  /** "Đã duyệt", "Máy dịch", "EN đã đổi", "Chưa dịch" (the default language: always reviewed). */
  state: TranslationState;
};

type LoadedRow = { key: string; locale: string; value: string; status: string; source_hash: string | null; token: string };

export async function loadScreenStrings(db: Db, screen: AdminScreen, locale: string = DEFAULT_LOCALE): Promise<StringField[]> {
  const keys = keysForScreen(screen);
  const { rows } = await db.query<LoadedRow>(
    `SELECT key, locale, value, status, source_hash, ${US('updated_at')} AS token
       FROM content_strings WHERE locale IN ($1, $2) AND key = ANY($3::text[])`,
    [locale, DEFAULT_LOCALE, keys],
  );
  const at = new Map(rows.map((r) => [`${r.key}\u0000${r.locale}`, r]));
  const isDefault = locale === DEFAULT_LOCALE;
  return keys.map((key) => {
    const row = at.get(`${key}\u0000${locale}`);
    const def: StringDef = REGISTRY[key];
    const english = at.get(`${key}\u0000${DEFAULT_LOCALE}`)?.value ?? def.en;
    // The registry's own Vietnamese is a reviewed translation, though it has no row.
    const shown = row ?? (registryLocaleDefault(key, locale) !== undefined ? { status: 'reviewed' } : null);
    return {
      key,
      value: row?.value ?? stringDefault(key, locale),
      def,
      overridden: !!row,
      token: row?.token ?? '',
      english,
      state: translationState(shown, stringSource(english), isDefault),
    };
  });
}

/**
 * values: what the form holds; originals: what it was loaded with (so a field
 * this editor left alone is skipped, never written back over a colleague's
 * newer text); tokens: the row versions it was loaded with.
 */
export type StringsInput = {
  screen: AdminScreen;
  /** The language the screen edits (a code of the locales table). */
  locale?: string;
  values: Partial<Record<string, string>>;
  originals: Partial<Record<string, string>>;
  tokens: Partial<Record<string, string>>;
};
/** policyVersion: the edited language's new policy version; policyChanged: any language got one (the policy page's tag). */
export type StringsSaved = { changed: StringKey[]; policyVersion: string | null; policyChanged: boolean };
/**
 * A save's answer: also each written key's new token ('' where the default now
 * shows), so the form can tell whether the page holds exactly what it wrote
 * (its in-flight typing, lib/admin/save-state.ts).
 */
export type StringsWritten = StringsSaved & { tokens: Partial<Record<string, string>> };
type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };

/** The field name of a key in the form, and of its error in fieldErrors. */
export const fieldName = (key: string) => `v:${key}`;
export const tokenName = (key: string) => `t:${key}`;
export const originalName = (key: string) => `o:${key}`;

const normalise = (raw: string) => raw.replace(/\r\n?/g, '\n').trim();

/**
 * Spec §7.4 checks of one value in `locale` against its registry entry:
 * length, ICU, the declared variables, and for a translation the kinds of
 * the English text's variables. An
 * empty translation is no value (the guest reads English): only English must
 * have text.
 */
export function validateValue(key: StringKey, value: string, locale: string = DEFAULT_LOCALE): string[] {
  const def: StringDef = REGISTRY[key];
  if (value.trim() === '') {
    return locale === DEFAULT_LOCALE ? ['Không được để trống. Muốn dùng chữ mặc định thì bấm “Khôi phục mặc định”.'] : [];
  }
  const errors: string[] = [];
  if ([...value].length > def.maxLength) errors.push(`Tối đa ${def.maxLength} ký tự (đang có ${[...value].length}).`);
  // English keeps the declared variables; a translation also keeps the English text's kinds (spec §7.4): an
  // English editor may write {count} where the default had {count, plural, …}, a translation may not drop it.
  const problems = checkMessage(value, def.vars ?? [], locale === DEFAULT_LOCALE ? undefined : messageArgs(def.en));
  if (locale === DEFAULT_LOCALE) {
    errors.push(...problems.map(describeProblem));
  } else {
    // A translation names its variables against the English text (spec §7.4), in one sentence.
    const missing = problems.flatMap((p) => (p.code === 'missing_var' ? [`{${p.name}}`] : []));
    const extra = problems.flatMap((p) => (p.code === 'unknown_var' ? [`{${p.name}}`] : []));
    if (missing.length || extra.length) {
      errors.push(
        `Biến khác bản tiếng Anh: ${[missing.length ? `thiếu ${missing.join(', ')}` : '', extra.length ? `thừa ${extra.join(', ')}` : ''].filter(Boolean).join(', ')}.`,
      );
    }
    errors.push(...problems.filter((p) => p.code === 'syntax' || p.code === 'var_type').map(describeProblem));
  }
  return errors;
}

/**
 * The refusal of a write to agreed text on a Preview (policyWritesRefused):
 * the version every production booking is stamped with would hash the
 * branch's registry defaults.
 */
export const AGREED_ON_PREVIEW = 'Chữ khách đồng ý (chính sách, câu đồng ý) chỉ sửa trên trang chính thức: bản preview dùng chung dữ liệu với Production.';

const isAgreed = (key: StringKey) => (AGREED_KEYS as readonly string[]).includes(key);

/** Whether `locale` is a language of the table: a screen edits only those. */
async function knownLocale(db: Db, locale: string): Promise<boolean> {
  return (await db.query('SELECT 1 FROM locales WHERE code = $1', [locale])).rowCount === 1;
}
const UNKNOWN_LOCALE: Invalid = { ok: false, code: 'invalid', fieldErrors: { locale: ['Ngôn ngữ này không có trong danh sách ngôn ngữ.'] } };

/**
 * Validates every submitted key of the screen, then, in one transaction, takes
 * every changed key's lock and checks its token before writing any (one stale
 * key refuses the whole save, so nothing is half-saved), writes them with
 * their audit rows, and when the change touches what a guest agrees to,
 * records the policy's new versions in the same transaction (R21, R8-7).
 */
export async function saveStrings(pool: Pool, actor: AuditActor, input: StringsInput): Promise<{ ok: true; data: StringsWritten } | Invalid | Conflict> {
  const locale = input.locale ?? DEFAULT_LOCALE;
  if (!(await knownLocale(pool, locale))) return UNKNOWN_LOCALE;
  const preview = policyWritesRefused();
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
    const errors = preview && isAgreed(key) ? [AGREED_ON_PREVIEW] : validateValue(key, value, locale);
    if (errors.length) fieldErrors[fieldName(key)] = errors;
    else submitted.push([key, value]);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, code: 'invalid', fieldErrors };
  // Locks in one order (by key) for every save, so two multi-key saves cannot deadlock.
  submitted.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return withTransaction(pool, async (client) => {
    const writes: { key: StringKey; value: string; row: StringRow | null }[] = [];
    for (const [key, value] of submitted) {
      const row = await lockedString(client, key, locale);
      if ((row?.value ?? stringDefault(key, locale)) === value) continue;
      if ((row?.token ?? '') !== (input.tokens[key] ?? '')) {
        return conflictFromHistory(client, 'content_strings', key, { by: row?.updated_by ?? null, at: row?.updated_at ?? new Date() }, locale);
      }
      writes.push({ key, value, row });
    }
    const changed: StringKey[] = [];
    for (const { key, value, row } of writes) {
      await writeString(client, actor, key, locale, value, row, null);
      changed.push(key);
    }
    const policy = agreedChanged(changed) ? await recordPolicyVersions(client, actor, locale) : { version: null, any: false };
    const { rows } = await client.query<{ key: string; token: string }>(
      `SELECT key, ${US('updated_at')} AS token FROM content_strings WHERE locale = $1 AND key = ANY($2::text[])`,
      [locale, changed],
    );
    const tokens = Object.fromEntries(changed.map((key) => [key, rows.find((r) => r.key === key)?.token ?? '']));
    return { ok: true, data: { changed, policyVersion: policy.version, policyChanged: policy.any, tokens } } as const;
  });
}

type StringRow = { value: string; token: string; updated_by: string | null; updated_at: Date };

/** The key's row in `locale` (null: the default shows), with that pair's lock taken: it serialises writes even while there is no row to lock. */
async function lockedString(client: PoolClient, key: StringKey, locale: string): Promise<StringRow | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('content_strings:' || $1 || ':' || $2))`, [key, locale]);
  const { rows } = await client.query<StringRow>(
    `SELECT value, ${US('updated_at')} AS token, updated_by, updated_at FROM content_strings WHERE key = $1 AND locale = $2`,
    [key, locale],
  );
  return rows[0] ?? null;
}

/**
 * Writes one key's value in `locale`, and its audit row with the whole state
 * on either side ({ value, overridden }), so History can put it back. The
 * language's default is no row (R20): writing it deletes the row. A
 * translation stores the fingerprint of the English text it was written
 * against (source_hash: "EN đã đổi" once English moves on).
 * `restoredFrom` names the audit row of a restore (action 'restore').
 */
async function writeString(
  client: PoolClient,
  actor: AuditActor,
  key: StringKey,
  locale: string,
  value: string,
  row: StringRow | null,
  restoredFrom: string | null,
) {
  const toDefault = value === stringDefault(key, locale);
  if (toDefault) {
    await client.query('DELETE FROM content_strings WHERE key = $1 AND locale = $2', [key, locale]);
  } else {
    let source: string | null = null;
    if (locale !== DEFAULT_LOCALE) {
      const { rows } = await client.query<{ value: string }>(`SELECT value FROM content_strings WHERE key = $1 AND locale = $2`, [key, DEFAULT_LOCALE]);
      source = stringSource(rows[0]?.value ?? REGISTRY[key].en);
    }
    await client.query(
      `INSERT INTO content_strings (key, locale, value, status, origin, source_hash, reviewed_by, reviewed_at, updated_at, updated_by)
       VALUES ($1, $2, $3, 'reviewed', 'human', $5, $4, now(), now(), $4)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value, status = 'reviewed', origin = 'human', ai_model = NULL, source_hash = EXCLUDED.source_hash,
             reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, locale, value, actor.id, source],
    );
  }
  await insertAudit(client, actor, {
    action: restoredFrom ? 'restore' : !row ? 'create' : toDefault ? 'delete' : 'update',
    entityType: 'content_strings',
    entityId: key,
    locale,
    before: { value: row?.value ?? stringDefault(key, locale), overridden: !!row },
    after: { value, overridden: !toDefault, ...(restoredFrom ? { meta: { restored_from: restoredFrom } } : {}) },
  });
}

/** What audit_log keeps of one key on either side of a write. */
export type StringVersion = { value: string; overridden: boolean };

function isStringVersion(v: unknown): v is StringVersion {
  const s = v as StringVersion | null;
  return !!s && typeof s.value === 'string' && typeof s.overridden === 'boolean';
}

export type StringRestoreInput = { key: string; locale?: string; auditId: string; side: 'before' | 'after'; token: string };
type NotFound = { ok: false; code: 'not_found' };

/**
 * "Khôi phục phiên bản này" for one key in one language (spec §7.5) through
 * §7.4: the key's lock and token ('' while the default shows), today's checks
 * of the value (code rule 5: the registry's variables may have changed
 * since), the write with action 'restore', and policy versions when the key
 * is agreed text. Restoring the default deletes the row.
 */
export async function restoreString(
  pool: Pool,
  actor: AuditActor,
  input: StringRestoreInput,
): Promise<{ ok: true; data: StringsSaved } | Invalid | Conflict | NotFound> {
  const { key } = input;
  const locale = input.locale ?? DEFAULT_LOCALE;
  if (!isStringKey(key)) return { ok: false, code: 'not_found' };
  if (isAgreed(key) && policyWritesRefused()) return { ok: false, code: 'invalid', fieldErrors: { [fieldName(key)]: [AGREED_ON_PREVIEW] } };
  return withTransaction(pool, async (client): Promise<{ ok: true; data: StringsSaved } | Invalid | Conflict | NotFound> => {
    const row = await lockedString(client, key, locale);
    const audit = await getAuditRow(client, input.auditId);
    const version = audit?.[input.side];
    // The row of this key in this language only: the same key has a row per language, and a restore in
    // one language must never write another language's text.
    if (!audit || audit.entity_type !== 'content_strings' || audit.entity_id !== key || audit.locale !== locale || !isStringVersion(version)) {
      return { ok: false, code: 'not_found' };
    }
    if ((row?.token ?? '') !== input.token) {
      return conflictFromHistory(client, 'content_strings', key, { by: row?.updated_by ?? null, at: row?.updated_at ?? new Date() }, locale);
    }
    const errors = validateValue(key, version.value, locale);
    if (errors.length) return { ok: false, code: 'invalid', fieldErrors: { [fieldName(key)]: errors } };
    if ((row?.value ?? stringDefault(key, locale)) === version.value) return { ok: true, data: { changed: [], policyVersion: null, policyChanged: false } };
    await writeString(client, actor, key, locale, version.value, row, input.auditId);
    const policy = agreedChanged([key]) ? await recordPolicyVersions(client, actor, locale) : { version: null, any: false };
    return { ok: true, data: { changed: [key], policyVersion: policy.version, policyChanged: policy.any } };
  });
}

/** One screen's string history in the language it edits, newest first (spec §7.5): the rows of its keys. */
export async function loadScreenHistory(db: Db, screen: AdminScreen, locale: string = DEFAULT_LOCALE, limit = HISTORY_LIMIT) {
  const keys = keysForScreen(screen);
  const { rows } = await db.query<HistoryEntry & { key: string }>(
    `SELECT a.id::text, a.entity_id AS key, a.at, a.action, a.before, a.after, coalesce(s.name, a.actor_email, 'Hệ thống') AS actor
       FROM audit_log a
       LEFT JOIN staff_user s ON s.id = a.actor_id
      WHERE a.entity_type = 'content_strings' AND a.entity_id = ANY($1::text[]) AND a.locale = $3
      ORDER BY a.at DESC, a.id DESC
      LIMIT $2`,
    [keys, limit, locale],
  );
  return rows;
}

/**
 * The tags a save of `keys` expires (spec §6.2; phase-6 ledger L7-6: one
 * place, like tagsForSave). The guest reads strings through two cached
 * loaders: getPrivacyStrings (content:legal) for the policy page's own keys,
 * getStrings (content:ui) for every other key a page or the chrome shows.
 * email.* keys are read uncached by the email sender: no tag (R6). A new
 * policy version also moves the date the policy page prints (content:legal;
 * phase-5 ledger T8.1).
 */
export function tagsForStrings(keys: readonly StringKey[], policyVersionChanged = false): string[] {
  const tags = new Set<string>();
  for (const key of keys) {
    if (key.startsWith('email.')) continue;
    tags.add((PRIVACY_KEYS as readonly string[]).includes(key) ? TAGS.contentLegal : TAGS.contentUi);
  }
  if (policyVersionChanged) tags.add(TAGS.contentLegal);
  return [...tags];
}

/** Whether a write touched what a guest agrees to (lib/legal.ts AGREED_KEYS). */
function agreedChanged(keys: readonly StringKey[]): boolean {
  return keys.some(isAgreed);
}
