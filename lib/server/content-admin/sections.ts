import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { HERO_AUTOPLAY_MS, SECTION_PARTS, sectionErrors } from '@/lib/admin/content-rules';
import { SECTION_KEYS, type SectionKey } from '@/lib/content/types';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy, type Conflict } from '@/lib/server/booking/config';
import type { Db } from '@/lib/server/booking/rules';
import { assertLiveMedia, reviveMedia } from '@/lib/server/media/library';
import { getAuditRow } from './history';
import { MEDIA_GONE } from './list-editor';
import { snapshotToken, type ItemSnapshot, type Row } from './snapshot';

/*
 * The home sections (spec §7.2 content/sections; §5.2 sections): each one's
 * switch, and the picture and link of the film, Experiences and Heritage.
 * One writer for both screens that edit them (C5, R23): the sections screen,
 * and the film part of the hero screen. A section is one row keyed by its
 * name, so its History is audit_log entity 'sections' with that key (R5); its
 * token is the hash of the row as the page showed it (R2, C8). The save flow
 * is spec §7.4's: lock the row, check the token, apply the rules (the same on
 * a restore: code rule 5), check the picture is live (code rule 2), write,
 * audit; the Server Action then expires tagsForSave(['sections']).
 *
 * Also here, because the hero screen edits it: site_settings.hero_autoplay_ms,
 * audited as entity 'site_settings' with id 'hero_autoplay_ms' (the shared
 * inbox, phase 5, audits the same row with id NULL), its token the hash of
 * that one value, so a save of the inbox address is never a conflict here.
 */

type Fail =
  | Conflict
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'missing_reference' }
  | { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };
export type SectionResult = { ok: true; data: null } | Fail;

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'Hero (ảnh lớn đầu trang)',
  film: 'Phim',
  finder: 'Tìm nhà hàng',
  cuisines: 'Ẩm thực',
  restaurants: 'Nhà hàng',
  destinations: 'Điểm đến',
  experiences: 'Experiences',
  heritage: 'Heritage',
  stories: 'Stories',
  offers: 'Ưu đãi',
  booking_bar: 'Thanh đặt bàn',
};

/** A section as History stores it: the row, no translations (sections has none). */
export async function readSection(db: Db, key: string): Promise<ItemSnapshot | null> {
  const { rows } = await db.query<{ row: Row }>('SELECT to_jsonb(s) AS row FROM sections s WHERE s.key = $1', [key]);
  return rows[0] ? { v: 1, row: rows[0].row, i18n: [] } : null;
}

export type SectionView = {
  key: SectionKey;
  label: string;
  visible: boolean;
  imageId: string | null;
  link: string | null;
  token: string;
  updatedAt: Date;
  updatedBy: string | null;
};

/** Every section, in the home page's order, as the screens show them. */
export async function listSectionsAdmin(db: Db): Promise<SectionView[]> {
  const { rows } = await db.query<{ row: Row; updated_by_name: string | null }>(
    `SELECT to_jsonb(s) AS row, st.name AS updated_by_name FROM sections s LEFT JOIN staff_user st ON st.id = s.updated_by`,
  );
  const byKey = new Map(rows.map((r) => [String(r.row.key), r]));
  return SECTION_KEYS.flatMap((key) => {
    const r = byKey.get(key);
    if (!r) return [];
    return [
      {
        key,
        label: SECTION_LABELS[key],
        visible: Boolean(r.row.is_visible),
        imageId: (r.row.image_id as string | null) ?? null,
        link: (r.row.link_url as string | null) ?? null,
        token: snapshotToken({ v: 1, row: r.row, i18n: [] }),
        updatedAt: new Date(String(r.row.updated_at)),
        updatedBy: r.updated_by_name,
      },
    ];
  });
}

export type SectionInput = { key: SectionKey; token: string; isVisible: boolean; imageId?: string | null; link?: string | null };

const invalid = (fieldErrors: Record<string, string[]>): Fail | null => (Object.keys(fieldErrors).length ? { ok: false, code: 'invalid', fieldErrors } : null);

/** The section's row, locked, and the page's token checked; or the refusal. */
async function lockSection(client: PoolClient, key: string, token: string): Promise<{ snapshot: ItemSnapshot } | Fail> {
  const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>('SELECT updated_by, updated_at FROM sections WHERE key = $1 FOR UPDATE', [key]);
  if (!rows[0]) return { ok: false, code: 'not_found' };
  const snapshot = (await readSection(client, key))!;
  if (snapshotToken(snapshot) !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return { snapshot };
}

const failed = (x: { snapshot: ItemSnapshot } | Fail): x is Fail => 'ok' in x;

async function writeSection(client: PoolClient, key: string, version: { visible: boolean; imageId: string | null; link: string | null }, actorId: string) {
  await client.query('UPDATE sections SET is_visible = $2, image_id = $3::uuid, link_url = $4, updated_at = now(), updated_by = $5 WHERE key = $1', [
    key,
    version.visible,
    version.imageId,
    version.link,
    actorId,
  ]);
}

/** "Lưu" of one section (spec §7.4). A part the section does not have (SECTION_PARTS) keeps its value. */
export async function saveSection(pool: Pool, actor: AuditActor, input: SectionInput): Promise<SectionResult> {
  return withTransaction(pool, async (client): Promise<SectionResult> => {
    const locked = await lockSection(client, input.key, input.token);
    if (failed(locked)) return locked;
    const row = locked.snapshot.row;
    const parts = SECTION_PARTS[input.key] ?? {};
    const version = {
      visible: input.isVisible,
      imageId: parts.image && input.imageId !== undefined ? input.imageId : ((row.image_id as string | null) ?? null),
      link: parts.link && input.link !== undefined ? input.link : ((row.link_url as string | null) ?? null),
    };
    const refused = invalid(sectionErrors(input.key, version));
    if (refused) return refused;
    // Code rule 2: the picture is live, and stays so until this commits.
    if (version.imageId && (await assertLiveMedia(client, [version.imageId], 'image')).length > 0) {
      return { ok: false, code: 'invalid', fieldErrors: { imageId: [MEDIA_GONE] } };
    }
    await writeSection(client, input.key, version, actor.id);
    await insertAudit(client, actor, { action: 'update', entityType: 'sections', entityId: input.key, before: locked.snapshot, after: await readSection(client, input.key) });
    return { ok: true, data: null };
  });
}

function isSectionSnapshot(value: unknown, key: string): value is ItemSnapshot {
  const s = value as ItemSnapshot | null;
  return !!s && s.v === 1 && typeof s.row === 'object' && s.row !== null && s.row.key === key;
}

export type RestoreInput = { id: string; auditId: string; side: 'before' | 'after'; token: string };

/**
 * "Khôi phục …" on a section's History (spec §7.5): its switch, picture and
 * link as that version had them, through today's rules (code rule 5). A
 * picture in the trash leaves it (C7); a purged one cannot come back.
 */
export async function restoreSection(pool: Pool, actor: AuditActor, input: RestoreInput): Promise<SectionResult> {
  return withTransaction(pool, async (client): Promise<SectionResult> => {
    const audit = await getAuditRow(client, input.auditId);
    const snapshot = audit?.[input.side];
    if (!audit || audit.entity_type !== 'sections' || audit.entity_id !== input.id || !isSectionSnapshot(snapshot, input.id)) {
      return { ok: false, code: 'not_found' };
    }
    const locked = await lockSection(client, input.id, input.token);
    if (failed(locked)) return locked;
    const version = {
      visible: Boolean(snapshot.row.is_visible),
      imageId: (snapshot.row.image_id as string | null) ?? null,
      link: (snapshot.row.link_url as string | null) ?? null,
    };
    const refused = invalid(sectionErrors(input.id, version));
    if (refused) return refused;
    if (version.imageId && (await reviveMedia(client, actor, [version.imageId])).length > 0) return { ok: false, code: 'missing_reference' };
    await writeSection(client, input.id, version, actor.id);
    const after = await readSection(client, input.id);
    await insertAudit(client, actor, {
      action: 'restore',
      entityType: 'sections',
      entityId: input.id,
      before: locked.snapshot,
      after: after && { ...after, meta: { restored_from: input.auditId } },
    });
    return { ok: true, data: null };
  });
}

// ── site_settings.hero_autoplay_ms ──────────────────────────────────────────

const AUTOPLAY = 'hero_autoplay_ms';

/** The autoplay pace as History stores it: one value, under the row id History names it by. */
export async function readAutoplay(db: Db): Promise<ItemSnapshot> {
  const { rows } = await db.query<{ ms: number }>('SELECT hero_autoplay_ms AS ms FROM site_settings WHERE id');
  return { v: 1, row: { id: AUTOPLAY, hero_autoplay_ms: rows[0].ms }, i18n: [] };
}

export async function getAutoplayEditor(db: Db): Promise<{ ms: number; token: string }> {
  const snapshot = await readAutoplay(db);
  return { ms: Number(snapshot.row.hero_autoplay_ms), token: snapshotToken(snapshot) };
}

/**
 * The pace's lock and token. site_settings.updated_at/by belong to the shared
 * inbox's form (its token, phase 5), which a pace save leaves alone, so a
 * conflict names who last wrote the pace from its own History row.
 */
async function lockAutoplay(client: PoolClient, token: string): Promise<{ snapshot: ItemSnapshot } | Conflict> {
  await client.query('SELECT 1 FROM site_settings WHERE id FOR UPDATE');
  const snapshot = await readAutoplay(client);
  if (snapshotToken(snapshot) === token) return { snapshot };
  const { rows } = await client.query<{ actor_id: string | null; at: Date }>(
    `SELECT actor_id, at FROM audit_log WHERE entity_type = 'site_settings' AND entity_id = $1 ORDER BY at DESC, id DESC LIMIT 1`,
    [AUTOPLAY],
  );
  return conflictBy(client, rows[0]?.actor_id ?? null, rows[0]?.at ?? new Date());
}

const autoplayError = (ms: number): Fail | null =>
  Number.isInteger(ms) && ms >= HERO_AUTOPLAY_MS.min && ms <= HERO_AUTOPLAY_MS.max
    ? null
    : { ok: false, code: 'invalid', fieldErrors: { seconds: [`Từ ${HERO_AUTOPLAY_MS.min / 1000} đến ${HERO_AUTOPLAY_MS.max / 1000} giây.`] } };

/** Writes the pace alone: updated_at/by are the shared inbox's token (lockAutoplay); who and when live in the audit row. */
async function writeAutoplay(client: PoolClient, actor: AuditActor, action: 'update' | 'restore', before: ItemSnapshot, ms: number, meta?: Row) {
  await client.query('UPDATE site_settings SET hero_autoplay_ms = $1 WHERE id', [ms]);
  const after = await readAutoplay(client);
  await insertAudit(client, actor, { action, entityType: 'site_settings', entityId: AUTOPLAY, before, after: meta ? { ...after, meta } : after });
}

/** "Lưu" of the hero's pace (spec §7.2 content/hero "thời gian tự chuyển slide"). */
export async function saveAutoplay(pool: Pool, actor: AuditActor, input: { token: string; ms: number }): Promise<SectionResult> {
  return withTransaction(pool, async (client): Promise<SectionResult> => {
    const locked = await lockAutoplay(client, input.token);
    if ('ok' in locked) return locked;
    const refused = autoplayError(input.ms);
    if (refused) return refused;
    await writeAutoplay(client, actor, 'update', locked.snapshot, input.ms);
    return { ok: true, data: null };
  });
}

export async function restoreAutoplay(pool: Pool, actor: AuditActor, input: RestoreInput): Promise<SectionResult> {
  return withTransaction(pool, async (client): Promise<SectionResult> => {
    const audit = await getAuditRow(client, input.auditId);
    const snapshot = audit?.[input.side] as ItemSnapshot | null | undefined;
    if (!audit || audit.entity_type !== 'site_settings' || audit.entity_id !== AUTOPLAY || input.id !== AUTOPLAY || snapshot?.v !== 1) {
      return { ok: false, code: 'not_found' };
    }
    const locked = await lockAutoplay(client, input.token);
    if ('ok' in locked) return locked;
    const ms = Number(snapshot.row?.hero_autoplay_ms);
    const refused = autoplayError(ms);
    if (refused) return refused;
    await writeAutoplay(client, actor, 'restore', locked.snapshot, ms, { restored_from: input.auditId });
    return { ok: true, data: null };
  });
}
