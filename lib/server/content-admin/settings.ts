import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { Saved } from '@/lib/admin/save-state';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy } from '@/lib/server/booking/config';
import type { Db } from '@/lib/server/booking/rules';
import { assertLiveMedia, reviveMedia } from '@/lib/server/media/library';
import { getAuditRow } from './history';
import { MEDIA_GONE, VERSION_INVALID, WHOLE_ITEM, type ListFailure, type ListResult, type RestoreInput } from './list-editor';
import { isForeignKeyViolation, isRuleViolation, snapshotToken, type ItemSnapshot, type MediaColumn, type Row } from './snapshot';

/*
 * A group of site_settings columns that one content screen edits together
 * (spec §5.2 site_settings, §7.4): the booking screen's defaults (B6), the
 * SEO screen's share picture (B7). site_settings is one row; each group is
 * its own History, audit_log entity 'site_settings' with the group's id
 * (R5, as the hero's pace 'hero_autoplay_ms'), and its own token, the hash
 * of the group's values (R2), so a save of another group, or of the shared
 * inbox (whose token is the row's updated_at, phase 5), is never a conflict
 * here. updated_at/by stay the inbox form's: who and when live in the audit
 * row. The save flow is spec §7.4's: lock the row, check the token, today's
 * rules (the same on a restore: code rule 5), live files (code rule 2; a
 * restore takes a trashed one out of the trash, C7), write, audit; the
 * Server Action then expires tagsForSave(['site_settings']).
 */

export type SettingsGroup = {
  /** audit_log.entity_id of the group's History (entity_type 'site_settings'). */
  id: string;
  /** The site_settings columns the group writes; SQL identifiers, never input. */
  columns: readonly string[];
  /** Columns that hold a media id (code rule 2, C7). */
  media?: readonly MediaColumn[];
  /** Today's rules on the values about to be written (a save, or a stored version on a restore), else null. */
  validate?: (client: PoolClient, row: Row) => Promise<ListFailure | null>;
};

/** The group as History stores it: its values under the group's id, no translations. */
export async function readSettings(db: Db, group: SettingsGroup): Promise<ItemSnapshot> {
  const { rows } = await db.query<Row>(`SELECT ${group.columns.join(', ')} FROM site_settings WHERE id`);
  return { v: 1, row: { id: group.id, ...rows[0] }, i18n: [] };
}

/** The values the screen's form shows, and its token. */
export async function getSettingsEditor(db: Db, group: SettingsGroup): Promise<{ values: Row; token: string }> {
  const snapshot = await readSettings(db, group);
  const { id: _id, ...values } = snapshot.row;
  return { values, token: snapshotToken(snapshot) };
}

/** The row's lock and the group's token; a conflict names whoever last wrote this group (its newest History row). */
async function lockGroup(client: PoolClient, group: SettingsGroup, token: string): Promise<{ snapshot: ItemSnapshot } | ListFailure> {
  await client.query('SELECT 1 FROM site_settings WHERE id FOR UPDATE');
  const snapshot = await readSettings(client, group);
  if (snapshotToken(snapshot) === token) return { snapshot };
  const { rows } = await client.query<{ actor_id: string | null; at: Date }>(
    `SELECT actor_id, at FROM audit_log WHERE entity_type = 'site_settings' AND entity_id = $1 ORDER BY at DESC, id DESC LIMIT 1`,
    [group.id],
  );
  return conflictBy(client, rows[0]?.actor_id ?? null, rows[0]?.at ?? new Date());
}

/** The group's media ids in `row`, by column. */
const mediaOf = (group: SettingsGroup, row: Row) =>
  (group.media ?? []).flatMap((m) => (typeof row[m.column] === 'string' && row[m.column] !== '' ? [{ ...m, id: String(row[m.column]) }] : []));

/** Writes the group's columns alone, and its audit row; answers the group's new token. */
async function write(
  client: PoolClient,
  actor: AuditActor,
  group: SettingsGroup,
  action: 'update' | 'restore',
  before: ItemSnapshot,
  row: Row,
  meta?: Row,
): Promise<string> {
  const cols = group.columns;
  await client.query(
    `UPDATE site_settings m
        SET (${cols.join(', ')}) = (SELECT ${cols.map((c) => `r.${c}`).join(', ')} FROM jsonb_populate_record(m, $1::jsonb) r)
      WHERE m.id`,
    [JSON.stringify(row)],
  );
  const after = await readSettings(client, group);
  await insertAudit(client, actor, { action, entityType: 'site_settings', entityId: group.id, before, after: meta ? { ...after, meta } : after });
  return snapshotToken(after);
}

/** "Lưu" of the group: `values` by column. Answers the token of the version it wrote (Saved, lib/admin/save-state.ts). */
export async function saveSettings(pool: Pool, actor: AuditActor, group: SettingsGroup, input: { token: string; values: Row }): Promise<ListResult<Saved>> {
  return withTransaction(pool, async (client): Promise<ListResult<Saved>> => {
    const locked = await lockGroup(client, group, input.token);
    if ('ok' in locked) return locked;
    const refused = await group.validate?.(client, input.values);
    if (refused) return refused;
    const fieldErrors: Record<string, string[]> = {};
    for (const kind of ['image', 'pdf'] as const) {
      const refs = mediaOf(group, input.values).filter((r) => r.kind === kind);
      const dead = await assertLiveMedia(
        client,
        refs.map((r) => r.id),
        kind,
      );
      for (const r of refs.filter((x) => dead.includes(x.id))) fieldErrors[r.field ?? r.column] = [MEDIA_GONE];
    }
    if (Object.keys(fieldErrors).length) return { ok: false, code: 'invalid', fieldErrors };
    return { ok: true, data: { token: await write(client, actor, group, 'update', locked.snapshot, input.values) } };
  });
}

/** "Khôi phục phiên bản này" of the group (spec §7.5), under today's rules. */
export async function restoreSettings(pool: Pool, actor: AuditActor, group: SettingsGroup, input: RestoreInput): Promise<ListResult> {
  try {
    return await withTransaction(pool, async (client): Promise<ListResult> => {
      const audit = await getAuditRow(client, input.auditId);
      const snapshot = audit?.[input.side] as ItemSnapshot | null | undefined;
      if (!audit || audit.entity_type !== 'site_settings' || audit.entity_id !== group.id || input.id !== group.id || snapshot?.v !== 1) {
        return { ok: false, code: 'not_found' };
      }
      const locked = await lockGroup(client, group, input.token);
      if ('ok' in locked) return locked;
      const row = Object.fromEntries(group.columns.map((c) => [c, snapshot.row?.[c] ?? null]));
      const refused = await group.validate?.(client, row);
      if (refused) return refused;
      // C7: a file this version shows that is now in the trash comes back with it; a purged one cannot.
      if ((await reviveMedia(client, actor, mediaOf(group, row).map((r) => r.id))).length > 0) return { ok: false, code: 'missing_reference' };
      await write(client, actor, group, 'restore', locked.snapshot, row, { restored_from: input.auditId });
      return { ok: true, data: null };
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) return { ok: false, code: 'missing_reference' };
    // A stored version that today's CHECK refuses (code rule 5): refused cleanly, the transaction rolled back.
    if (isRuleViolation(err)) return { ok: false, code: 'invalid', fieldErrors: { [WHOLE_ITEM]: [VERSION_INVALID] } };
    throw err;
  }
}

// ── The SEO screen's share picture (spec §5.2 site_settings.og_image_id, §7.2 content/seo) ──

/** The picture a shared link shows, for the home page and every page without its own (L7-13); NULL: none. */
export const SHARE_IMAGE: SettingsGroup = {
  id: 'og_image',
  columns: ['og_image_id'],
  media: [{ column: 'og_image_id', kind: 'image', field: 'ogImageId' }],
};

// ── The booking screen's defaults (spec §5.2, §7.2 content/booking) ─────────

/** The meals the finder may start on (CHECK site_settings.default_occasion, migration 008). */
export const OCCASIONS = ['Breakfast', 'Lunch', 'Dinner', 'Drinks'] as const;

export const UNKNOWN_RESTAURANT = 'Nhà hàng này không còn. Chọn nhà hàng khác.';
export const UNKNOWN_OCCASION = 'Chọn một bữa trong danh sách.';

/**
 * The restaurant the booking bar and the reservation form start on (NULL: the
 * first that books online; one that does not book online now is skipped the
 * same way), and the meal the finder starts on (NULL: any occasion).
 */
export const BOOKING_DEFAULTS: SettingsGroup = {
  id: 'booking_defaults',
  columns: ['default_restaurant_id', 'default_occasion'],
  async validate(client, row): Promise<ListFailure | null> {
    const occasion = row.default_occasion;
    if (occasion !== null && !(OCCASIONS as readonly unknown[]).includes(occasion)) {
      return { ok: false, code: 'invalid', fieldErrors: { defaultOccasion: [UNKNOWN_OCCASION] } };
    }
    const restaurant = row.default_restaurant_id;
    if (restaurant !== null && !(await client.query('SELECT 1 FROM restaurants WHERE id = $1 AND archived_at IS NULL', [restaurant])).rowCount) {
      return { ok: false, code: 'invalid', fieldErrors: { defaultRestaurantId: [UNKNOWN_RESTAURANT] } };
    }
    return null;
  },
};
