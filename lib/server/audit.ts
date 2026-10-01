import 'server-only';
import { isIP } from 'node:net';
import type { Pool, PoolClient } from 'pg';

/*
 * The audit half of the save flow (spec §7.4): every admin write runs inside
 * withTransaction and calls insertAudit on the same client, so the change and
 * its audit row commit or roll back together.
 */

/** Who did it: a snapshot (no foreign key), so the log outlives a removed account. */
export type AuditActor = { id: string; email: string; name?: string; ip?: string | null };

export type AuditEntry = {
  action: string; // create | update | delete | reorder | restore | settings | staff.*
  entityType: string;
  entityId: string | null;
  locale?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function insertAudit(client: PoolClient, actor: AuditActor | null, entry: AuditEntry): Promise<void> {
  // isIP accepts an IPv6 zone id ('fe80::1%lo0') but Postgres inet rejects it, which would roll back the whole action.
  const ip = actor?.ip && !actor.ip.includes('%') && isIP(actor.ip) ? actor.ip : null;
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, locale, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.locale ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      ip,
    ],
  );
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
