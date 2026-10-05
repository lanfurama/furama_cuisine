import 'server-only';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveStrings } from '@/lib/i18n/resolve';
import { AGREED_KEYS, PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { venueNow } from '@/lib/venue-time';
import { insertAudit, type AuditActor } from '../audit';
import { loadStringRows } from './strings.queries';

/*
 * The privacy policy's version (spec §11; phase-5 ledger T8.2), one
 * legal_versions row per wording (migration 009). A booking stores the
 * version in force (lib/server/booking/create.ts), the policy page prints its
 * date, and a content save that changes the agreed English text adds a row in
 * the same transaction (recordPolicyVersion).
 */

type Db = Pool | PoolClient;
export type PolicyVersion = { version: string; effectiveOn: string };

/** The same hash lib/legal.test.ts pins for the registry defaults: JSON of [key, English text] pairs in AGREED_KEYS order. */
export function policyTextHash(text: Record<(typeof AGREED_KEYS)[number], string>): string {
  return createHash('sha256')
    .update(JSON.stringify(AGREED_KEYS.map((k) => [k, text[k]])))
    .digest('hex');
}

export async function currentPolicyVersion(db: Db): Promise<PolicyVersion & { sha256: string | null }> {
  const { rows } = await db.query<{ version: string; effective_on: string; text_sha256: string }>(
    `SELECT version, to_char(effective_on, 'YYYY-MM-DD') AS effective_on, text_sha256
       FROM legal_versions ORDER BY created_at DESC, version DESC LIMIT 1`,
  );
  return rows[0]
    ? { version: rows[0].version, effectiveOn: rows[0].effective_on, sha256: rows[0].text_sha256 }
    : { version: PRIVACY_POLICY_VERSION, effectiveOn: PRIVACY_POLICY_VERSION, sha256: null };
}

/**
 * Inside a save's transaction, after its writes: adds a version when the
 * agreed English text no longer matches the newest row, and returns it (null
 * when the text is unchanged: a save that only touched other keys, or put back
 * the same words). The version is today's Da Nang date, suffixed for a second
 * change the same day. The advisory lock keeps two saves from picking the same
 * name.
 */
export async function recordPolicyVersion(client: PoolClient, actor: AuditActor, now = new Date()): Promise<string | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('legal_versions'))`);
  const { defaultLocale, rows } = await loadStringRows('en', AGREED_KEYS, client);
  const sha256 = policyTextHash(resolveStrings(rows, AGREED_KEYS, 'en', defaultLocale));
  const current = await currentPolicyVersion(client);
  if (current.sha256 === sha256) return null;

  const today = venueNow(now).date;
  const { rows: taken } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM legal_versions WHERE effective_on = $1::date`,
    [today],
  );
  const version = taken[0].n === 0 ? today : `${today}.${taken[0].n + 1}`;
  // created_at orders the versions (currentPolicyVersion, create.ts), so it is the time of this insert,
  // under the lock, not now(): now() is when the transaction began, and a save that began first but
  // waited for the lock would otherwise file the newest wording under an older time.
  await client.query(
    `INSERT INTO legal_versions (version, effective_on, text_sha256, created_at, created_by) VALUES ($1, $2::date, $3, clock_timestamp(), $4)`,
    [version, today, sha256, actor.id],
  );
  await insertAudit(client, actor, {
    action: 'create',
    entityType: 'legal_versions',
    entityId: version,
    before: { version: current.version },
    after: { version, sha256 },
  });
  return version;
}

/** Every version, newest first (the legal screen's list). */
export async function listPolicyVersions(db: Db): Promise<PolicyVersion[]> {
  const { rows } = await db.query<{ version: string; effective_on: string }>(
    `SELECT version, to_char(effective_on, 'YYYY-MM-DD') AS effective_on FROM legal_versions ORDER BY created_at DESC, version DESC`,
  );
  return rows.map((r) => ({ version: r.version, effectiveOn: r.effective_on }));
}
