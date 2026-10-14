import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { Pool } from 'pg';
import { getPool, type Db } from '@/db/client';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { TAGS } from '@/lib/cache-tags';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy, US, type Conflict } from '@/lib/server/conflict';

/*
 * The AI configuration (spec §9.2): one row, ai_settings.data, zod-checked on
 * every read so code owns the defaults ({} parses to all of them). The save
 * follows saveBookingSettings: one transaction with its audit_log row and
 * updated_at, in microseconds, as the conflict token. The Server Action
 * expires TAGS.aiSettings afterwards.
 */

/** For the settings screen: not cached, with the save's token. */
export async function loadAiSettings(db: Db = getPool()): Promise<{ settings: AiSettings; token: string }> {
  const { rows } = await db.query<{ data: unknown; token: string }>(`SELECT data, ${US('updated_at')} AS token FROM ai_settings WHERE id = 1`);
  return { settings: AiSettingsSchema.parse(rows[0]?.data ?? {}), token: rows[0]?.token ?? '' };
}

/** For the AI routes: cached, refreshed when a save expires TAGS.aiSettings. */
export async function cachedAiSettings(): Promise<AiSettings> {
  'use cache';
  cacheTag(TAGS.aiSettings);
  cacheLife('hours');
  const { rows } = await getPool().query<{ data: unknown }>('SELECT data FROM ai_settings WHERE id = 1');
  return AiSettingsSchema.parse(rows[0]?.data ?? {});
}

/** Throws ZodError when `settings` is not valid (the action answers `invalid`). */
export async function saveAiSettings(
  pool: Pool,
  actor: AuditActor,
  input: { settings: unknown; token: string },
): Promise<{ ok: true; data: null } | Conflict> {
  const settings = AiSettingsSchema.parse(input.settings);
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date; data: unknown }>(
      `SELECT ${US('updated_at')} AS token, updated_by, updated_at, data FROM ai_settings WHERE id = 1 FOR UPDATE`,
    );
    if (rows[0]?.token !== input.token) return conflictBy(client, rows[0]?.updated_by ?? null, rows[0]?.updated_at ?? new Date());
    const before = AiSettingsSchema.parse(rows[0].data ?? {});
    await client.query('UPDATE ai_settings SET data = $1::jsonb, updated_at = now(), updated_by = $2 WHERE id = 1', [JSON.stringify(settings), actor.id]);
    await insertAudit(client, actor, { action: 'settings', entityType: 'ai_settings', entityId: null, before, after: settings });
    return { ok: true, data: null } as const;
  });
}
