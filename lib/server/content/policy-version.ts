import 'server-only';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveStrings } from '@/lib/i18n/resolve';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { AGREED_KEYS, PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { venueNow } from '@/lib/venue-time';
import { insertAudit, type AuditActor } from '../audit';
import { loadStringRows } from './strings.queries';

/*
 * The privacy policy's version (spec §11; phase-5 ledger T8.2), one
 * legal_versions row per language and wording (migrations 009, 010). A booking
 * stores the version in force and its language (lib/server/booking/create.ts),
 * the policy page prints the date of its own language's version, and a
 * content save that changes the agreed text a language's guests read adds a
 * row for that language in the same transaction (recordPolicyVersions, R8-7).
 */

type Db = Pool | PoolClient;
export type PolicyVersion = { version: string; effectiveOn: string };

/** The same hash lib/legal.test.ts pins for the registry defaults: JSON of [key, text] pairs in AGREED_KEYS order. */
export function policyTextHash(text: Record<(typeof AGREED_KEYS)[number], string>): string {
  return createHash('sha256')
    .update(JSON.stringify(AGREED_KEYS.map((k) => [k, text[k]])))
    .digest('hex');
}

type Current = PolicyVersion & { sha256: string | null; locale: string };

/** The newest version of `locale`'s own wording, or null when that language has none yet. */
async function newestOf(db: Db, locale: string): Promise<Current | null> {
  const { rows } = await db.query<{ version: string; effective_on: string; text_sha256: string }>(
    `SELECT version, to_char(effective_on, 'YYYY-MM-DD') AS effective_on, text_sha256
       FROM legal_versions WHERE locale = $1 ORDER BY created_at DESC, version DESC LIMIT 1`,
    [locale],
  );
  return rows[0] ? { version: rows[0].version, effectiveOn: rows[0].effective_on, sha256: rows[0].text_sha256, locale } : null;
}

/**
 * The version in force for a guest reading `locale`: that language's newest,
 * else the default language's (a guest of a language without its own versions
 * agrees to the English wording; `locale` says which: the booking's
 * consent_locale), else the seeded constant.
 */
export async function currentPolicyVersion(db: Db, locale: string = DEFAULT_LOCALE): Promise<Current> {
  return (
    (await newestOf(db, locale)) ??
    (locale !== DEFAULT_LOCALE ? await newestOf(db, DEFAULT_LOCALE) : null) ?? {
      version: PRIVACY_POLICY_VERSION,
      effectiveOn: PRIVACY_POLICY_VERSION,
      sha256: null,
      locale: DEFAULT_LOCALE,
    }
  );
}

/**
 * Whether this deployment must not write agreed text (and so no new policy
 * version): a Preview shares production's database (2026-10-05) but hashes
 * the agreed text through its own branch's registry defaults, so its version
 * row would stamp every production booking with a wording production does
 * not show. Other keys still save on a Preview.
 */
export function policyWritesRefused(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'preview';
}

/**
 * Inside a save's transaction, after its writes: adds a version of `locale`
 * when the agreed text its guests read (each key's own row, else its
 * fallback, as the policy page resolves it) no longer matches that language's
 * newest row, and returns it (null when the text is unchanged). The version is
 * today's Da Nang date, suffixed for a second change the same day in that
 * language. The language's advisory lock keeps two saves from picking the same
 * name.
 */
export async function recordPolicyVersion(client: PoolClient, actor: AuditActor, locale: string = DEFAULT_LOCALE, now = new Date()): Promise<string | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('legal_versions:' || $1))`, [locale]);
  const { defaultLocale, rows } = await loadStringRows(locale, AGREED_KEYS, client);
  const sha256 = policyTextHash(resolveStrings(rows, AGREED_KEYS, locale, defaultLocale));
  const current = await newestOf(client, locale);
  if (current?.sha256 === sha256) return null;

  const today = venueNow(now).date;
  const { rows: taken } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM legal_versions WHERE locale = $1 AND effective_on = $2::date`,
    [locale, today],
  );
  const version = taken[0].n === 0 ? today : `${today}.${taken[0].n + 1}`;
  // created_at orders the versions (currentPolicyVersion, create.ts), so it is the time of this insert,
  // under the lock, not now(): now() is when the transaction began, and a save that began first but
  // waited for the lock would otherwise file the newest wording under an older time.
  await client.query(
    `INSERT INTO legal_versions (locale, version, effective_on, text_sha256, created_at, created_by) VALUES ($1, $2, $3::date, $4, clock_timestamp(), $5)`,
    [locale, version, today, sha256, actor.id],
  );
  await insertAudit(client, actor, {
    action: 'create',
    entityType: 'legal_versions',
    entityId: version,
    locale,
    before: { version: current?.version ?? null },
    after: { version, sha256 },
  });
  return version;
}

/**
 * After a save of agreed text in `locale`: a version for that language, and
 * for every other language that has versions whose text moved with it (a
 * language without its own row of an agreed key reads the English one, so an
 * English save changes what its guests agree to; R8-7). Languages in code
 * order, so two saves take the locks in the same order. Returns the saved
 * language's new version (null: unchanged) and whether any language got one.
 */
export async function recordPolicyVersions(
  client: PoolClient,
  actor: AuditActor,
  locale: string,
  now = new Date(),
): Promise<{ version: string | null; any: boolean }> {
  const { rows } = await client.query<{ locale: string }>(`SELECT DISTINCT locale FROM legal_versions`);
  const locales = [...new Set([locale, ...rows.map((r) => r.locale)])].sort();
  let version: string | null = null;
  let any = false;
  for (const code of locales) {
    const added = await recordPolicyVersion(client, actor, code, now);
    if (added) any = true;
    if (code === locale) version = added;
  }
  return { version, any };
}

/** Every version of `locale`, newest first (the legal screen's list). */
export async function listPolicyVersions(db: Db, locale: string = DEFAULT_LOCALE): Promise<PolicyVersion[]> {
  const { rows } = await db.query<{ version: string; effective_on: string }>(
    `SELECT version, to_char(effective_on, 'YYYY-MM-DD') AS effective_on FROM legal_versions WHERE locale = $1 ORDER BY created_at DESC, version DESC`,
    [locale],
  );
  return rows.map((r) => ({ version: r.version, effectiveOn: r.effective_on }));
}
