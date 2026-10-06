import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { Saved } from '@/lib/admin/save-state';
import type { MediaContentType } from '@/lib/media/rules';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictFromHistory, type Conflict } from '@/lib/server/booking/config';
import type { Db } from '@/lib/server/booking/rules';
import { getAuditRow } from '@/lib/server/content-admin/history';
import { readItem, snapshotToken, upsertTranslation, writeChangedTranslations, writeItem, type ItemDef, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import type { Measured } from './measure';

/*
 * The media library's rows (spec §5.2 media / media_i18n, §7.2 /admin/media).
 * A file is an ItemDef like every content entity (R5, C6, C8): audit_log
 * keeps the row and its media_i18n rows as an ItemSnapshot under entity
 * 'media', the page's token is the snapshot's hash, and History restores a
 * version through the same writer. Every write follows spec §7.4: one
 * transaction with its audit row, then the caller expires `media` after the
 * commit when the file is shown somewhere.
 *
 * Delete is soft (deleted_at), as 008 designed it (R14): the file stays in
 * the store and the row stays restorable until the media-sweep cron purges it
 * after 30 days. Content tables reference media ON DELETE RESTRICT, which a
 * soft delete never trips, so the library checks the uses itself, under a row
 * lock that serialises with any save that references the file
 * (assertLiveMedia below takes FOR KEY SHARE on the same row): AC3.
 */

type NotFound = { ok: false; code: 'not_found' };
type Ok = { ok: true; data: null };

/** A file as History stores it: what a restore may write back (the rest is the upload's, never edited). */
export const MEDIA: ItemDef = {
  entityType: 'media',
  table: 'media',
  idType: 'uuid',
  columns: ['is_decorative'],
  i18n: { table: 'media_i18n', fk: 'media_id', columns: ['alt'] },
  tables: ['media', 'media_i18n'],
};

/** A place a file is shown. `href` is the admin screen that edits it. */
export type MediaUse = { label: string; href: string };

/**
 * Every column that references media(id) except media_i18n (its own alt
 * text). test/integration/media-library.test.ts compares this list with
 * pg_constraint, so a new reference in a later migration fails CI until it is
 * named here and in USAGE_SQL.
 */
export const MEDIA_REFERENCES = [
  { table: 'restaurants', column: 'card_image_id' },
  { table: 'restaurants', column: 'detail_image_id' },
  { table: 'restaurants', column: 'og_image_id' },
  { table: 'restaurant_i18n', column: 'menu_pdf_media_id' },
  { table: 'restaurant_highlights', column: 'image_id' },
  { table: 'destinations', column: 'card_image_id' },
  { table: 'cuisines', column: 'image_id' },
  { table: 'sections', column: 'image_id' },
  { table: 'hero_slides', column: 'image_id' },
  { table: 'hero_slides', column: 'image_mobile_id' },
  { table: 'stories', column: 'image_id' },
  { table: 'site_settings', column: 'og_image_id' },
] as const;

// One UNION per reference above; $1 is the media id. Names come from the default language, the one every language falls back to (spec §7).
const USAGE_SQL = `
  SELECT 'Ảnh thẻ nhà hàng ' || r.name AS label, '/admin/restaurants/' || r.id AS href FROM restaurants r WHERE r.card_image_id = $1
  UNION ALL SELECT 'Ảnh chân dung trang ' || r.name, '/admin/restaurants/' || r.id FROM restaurants r WHERE r.detail_image_id = $1
  UNION ALL SELECT 'Ảnh chia sẻ của ' || r.name, '/admin/restaurants/' || r.id FROM restaurants r WHERE r.og_image_id = $1
  UNION ALL SELECT 'Menu PDF (' || ri.locale || ') của ' || r.name, '/admin/restaurants/' || r.id
              FROM restaurant_i18n ri JOIN restaurants r ON r.id = ri.restaurant_id WHERE ri.menu_pdf_media_id = $1
  UNION ALL SELECT 'Điểm nổi bật #' || h.id || ' của ' || r.name, '/admin/restaurants/' || r.id
              FROM restaurant_highlights h JOIN restaurants r ON r.id = h.restaurant_id WHERE h.image_id = $1
  UNION ALL SELECT 'Thẻ điểm đến ' || coalesce(di.name, d.id), '/admin/content/destinations'
              FROM destinations d LEFT JOIN destination_i18n di ON di.destination_id = d.id
                AND di.locale = (SELECT code FROM locales WHERE is_default) WHERE d.card_image_id = $1
  UNION ALL SELECT 'Ẩm thực ' || c.id, '/admin/content/cuisines' FROM cuisines c WHERE c.image_id = $1
  UNION ALL SELECT 'Section ' || s.key, '/admin/content/sections' FROM sections s WHERE s.image_id = $1
  UNION ALL SELECT 'Hero slide #' || hs.id, '/admin/content/hero' FROM hero_slides hs WHERE hs.image_id = $1
  UNION ALL SELECT 'Hero slide #' || hs.id || ' (ảnh mobile)', '/admin/content/hero' FROM hero_slides hs WHERE hs.image_mobile_id = $1
  UNION ALL SELECT 'Câu chuyện #' || st.id, '/admin/content/stories' FROM stories st WHERE st.image_id = $1
  UNION ALL SELECT 'Ảnh chia sẻ mặc định (SEO)', '/admin/content/seo' FROM site_settings ss WHERE ss.og_image_id = $1`;

export async function mediaUsage(db: Db, id: string): Promise<MediaUse[]> {
  const { rows } = await db.query<MediaUse>(`SELECT label, href FROM (${USAGE_SQL}) u ORDER BY label`, [id]);
  return rows;
}

// ── reading ────────────────────────────────────────────────────────────────

export type LibraryItem = {
  id: string;
  storage: 'static' | 'blob';
  url: string;
  pathname: string;
  contentType: MediaContentType;
  width: number | null;
  height: number | null;
  bytes: number;
  blurDataUrl: string | null;
  isDecorative: boolean;
  /** EN alt (the default language's row); '' when there is none. */
  alt: string;
  uses: number;
  deletedAt: Date | null;
  updatedAt: Date;
};

const ITEM_COLUMNS = `m.id::text, m.storage, m.url, m.pathname, m.content_type AS "contentType", m.width, m.height, m.bytes,
  m.blur_data_url AS "blurDataUrl", m.is_decorative AS "isDecorative", coalesce(mi.alt, '') AS alt,
  m.deleted_at AS "deletedAt", m.updated_at AS "updatedAt"`;
const ALT_JOIN = `LEFT JOIN media_i18n mi ON mi.media_id = m.id AND mi.locale = (SELECT code FROM locales WHERE is_default)`;
const USES = MEDIA_REFERENCES.map(({ table, column }) => `(SELECT count(*) FROM ${table} WHERE ${column} = m.id)`).join(' + ');

/** The library grid: live files, newest first, filtered by name, alt or type. */
export async function listMedia(db: Db, filter: { q?: string; kind?: 'image' | 'pdf' } = {}): Promise<LibraryItem[]> {
  const where = ['m.deleted_at IS NULL'];
  const values: unknown[] = [];
  if (filter.q) {
    values.push(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(m.pathname ILIKE $${values.length} OR mi.alt ILIKE $${values.length})`);
  }
  if (filter.kind === 'pdf') where.push(`m.content_type = 'application/pdf'`);
  if (filter.kind === 'image') where.push(`m.content_type <> 'application/pdf'`);
  const { rows } = await db.query<LibraryItem>(
    `SELECT ${ITEM_COLUMNS}, (${USES})::int AS uses FROM media m ${ALT_JOIN}
      WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.pathname LIMIT 500`,
    values,
  );
  return rows;
}

/** The trash (R14): soft-deleted files the sweep has not purged yet, newest first; each page keeps its History. */
export async function listTrashed(db: Db, limit = 20): Promise<LibraryItem[]> {
  const { rows } = await db.query<LibraryItem>(
    `SELECT ${ITEM_COLUMNS}, (${USES})::int AS uses FROM media m ${ALT_JOIN}
      WHERE m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC, m.pathname LIMIT $1`,
    [limit],
  );
  return rows;
}

/** One file, live or in the trash, with its page's token (R2); null once the sweep purged it. */
export async function getMedia(db: Db, id: string): Promise<(LibraryItem & { token: string; snapshot: ItemSnapshot }) | null> {
  const [{ rows }, snapshot] = await Promise.all([
    db.query<LibraryItem>(`SELECT ${ITEM_COLUMNS}, (${USES})::int AS uses FROM media m ${ALT_JOIN} WHERE m.id = $1::uuid`, [id]),
    readItem(db, MEDIA, id),
  ]);
  return rows[0] && snapshot ? { ...rows[0], token: snapshotToken(snapshot), snapshot } : null;
}

// ── writing ────────────────────────────────────────────────────────────────

export type RegisterInput = { pathname: string; url: string; measured: Measured; alt?: string | null; decorative?: boolean };

/**
 * Upload step 2 (spec §11): the row for a file now in the store. Upserts by
 * pathname (media_pathname_key), so a retried registerMedia after a lost
 * answer neither fails nor duplicates; a re-register keeps the alt text.
 */
export async function registerMediaRow(pool: Pool, actor: AuditActor, input: RegisterInput): Promise<{ ok: true; data: { id: string; created: boolean } }> {
  return withTransaction(pool, async (client) => {
    const { rows: prior } = await client.query<{ id: string }>('SELECT id::text FROM media WHERE pathname = $1 FOR UPDATE', [input.pathname]);
    const before = prior[0] ? await readItem(client, MEDIA, prior[0].id) : null;
    const m = input.measured;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, blur_data_url, is_decorative, created_by, updated_by)
       VALUES ('blob', $1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (pathname) DO UPDATE
          SET url = EXCLUDED.url, content_type = EXCLUDED.content_type, width = EXCLUDED.width, height = EXCLUDED.height,
              bytes = EXCLUDED.bytes, blur_data_url = EXCLUDED.blur_data_url, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING id::text`,
      [input.url, input.pathname, m.contentType, m.width, m.height, m.bytes, m.blurDataUrl, input.decorative ?? false, actor.id],
    );
    const id = rows[0].id;
    const alt = input.alt?.trim();
    if (!prior[0] && alt && m.contentType !== 'application/pdf') await upsertTranslation(client, MEDIA, id, await defaultLocale(client), { alt }, actor.id);
    await insertAudit(client, actor, { action: prior[0] ? 'update' : 'create', entityType: 'media', entityId: id, before, after: await readItem(client, MEDIA, id) });
    return { ok: true as const, data: { id, created: !prior[0] } };
  });
}

async function defaultLocale(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ code: string }>('SELECT code FROM locales WHERE is_default');
  return rows[0].code;
}

/** Locks a file's row and checks the page's token; a file in the trash is not found (only History brings it back). */
async function lockLive(client: PoolClient, id: string, token: string): Promise<{ snapshot: ItemSnapshot } | NotFound | Conflict> {
  const { rows } = await client.query<{ deleted: boolean; updated_by: string | null; updated_at: Date }>(
    'SELECT deleted_at IS NOT NULL AS deleted, updated_by, updated_at FROM media WHERE id = $1::uuid FOR UPDATE',
    [id],
  );
  if (!rows[0] || rows[0].deleted) return { ok: false, code: 'not_found' };
  const snapshot = (await readItem(client, MEDIA, id))!;
  if (snapshotToken(snapshot) !== token) return conflictFromHistory(client, MEDIA.entityType, id, { by: rows[0].updated_by, at: rows[0].updated_at });
  return { snapshot };
}

/**
 * The alt text, in the default language and in each other one (phase 8), and
 * the decorative flag (spec §7.3, R12: edited on the file, shared by every
 * use). Another language's alt is written only when it changed, with the
 * default alt's fingerprint ("EN đã đổi"); emptied, its row goes ("use
 * English"). Answers the token of the version it wrote (Saved,
 * lib/admin/save-state.ts).
 */
export async function saveMediaDetails(
  pool: Pool,
  actor: AuditActor,
  input: { id: string; token: string; alt: string; decorative: boolean; translations?: Record<string, string> },
): Promise<{ ok: true; data: Saved } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockLive(client, input.id, input.token);
    if (!('snapshot' in locked)) return locked;
    await client.query('UPDATE media SET is_decorative = $2, updated_at = now(), updated_by = $3 WHERE id = $1::uuid', [input.id, input.decorative, actor.id]);
    const locale = await defaultLocale(client);
    const alt = input.alt.trim();
    // media_i18n holds a row only when there is alt text (008): an empty field removes the language's row.
    if (alt) await upsertTranslation(client, MEDIA, input.id, locale, { alt }, actor.id);
    else await client.query('DELETE FROM media_i18n WHERE media_id = $1::uuid AND locale = $2', [input.id, locale]);
    const others = Object.entries(input.translations ?? {}).filter(([code]) => code !== locale);
    if (others.length) {
      await writeChangedTranslations(client, MEDIA, input.id, Object.fromEntries(others.map(([code, text]) => [code, { alt: text.trim() || null }])), actor.id);
    }
    const after = await readItem(client, MEDIA, input.id);
    await insertAudit(client, actor, { action: 'update', entityType: 'media', entityId: input.id, before: locked.snapshot, after });
    return { ok: true as const, data: { token: snapshotToken(after) } };
  });
}

export type InUse = { ok: false; code: 'in_use'; uses: MediaUse[] };

/**
 * "Xóa file" (AC3): refused while any row uses the file (with the list),
 * otherwise a soft delete. The FOR UPDATE in lockLive conflicts with the FOR
 * KEY SHARE a referencing save takes (its foreign-key check, and
 * assertLiveMedia), so the two never interleave: either the save commits first
 * and the usage query below sees it, or the delete commits first and the save
 * finds the file gone.
 */
export async function deleteMedia(pool: Pool, actor: AuditActor, input: { id: string; token: string }): Promise<Ok | NotFound | Conflict | InUse> {
  return withTransaction(pool, async (client) => {
    const locked = await lockLive(client, input.id, input.token);
    if (!('snapshot' in locked)) return locked;
    const uses = await mediaUsage(client, input.id);
    if (uses.length > 0) return { ok: false as const, code: 'in_use' as const, uses };
    await client.query('UPDATE media SET deleted_at = now(), updated_at = now(), updated_by = $2 WHERE id = $1::uuid', [input.id, actor.id]);
    await insertAudit(client, actor, { action: 'delete', entityType: 'media', entityId: input.id, before: locked.snapshot, after: await readItem(client, MEDIA, input.id) });
    return { ok: true as const, data: null };
  });
}

function isMediaSnapshot(value: unknown, id: string): value is ItemSnapshot {
  const s = value as ItemSnapshot | null;
  return !!s && s.v === 1 && typeof s.row === 'object' && s.row !== null && String(s.row.id) === id && Array.isArray(s.i18n);
}

/**
 * "Khôi phục …" on a file's History (spec §7.5, R14): its alt text, its
 * decorative flag and whether it is in the trash, as that version had them.
 * Today's rule applies (code rule 5): a version with the file deleted comes
 * back only while nothing shows it. A file the sweep purged has no row left
 * (and no bytes in the store): nothing to restore.
 */
export async function restoreMedia(
  pool: Pool,
  actor: AuditActor,
  input: { id: string; auditId: string; side: 'before' | 'after'; token: string },
): Promise<Ok | NotFound | Conflict | InUse | { ok: false; code: 'missing_reference' }> {
  return withTransaction(pool, async (client) => {
    const audit = await getAuditRow(client, input.auditId);
    const snapshot = audit?.[input.side];
    if (!audit || audit.entity_type !== MEDIA.entityType || audit.entity_id !== input.id || !isMediaSnapshot(snapshot, input.id)) {
      return { ok: false as const, code: 'not_found' as const };
    }
    const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>('SELECT updated_by, updated_at FROM media WHERE id = $1::uuid FOR UPDATE', [input.id]);
    if (!rows[0]) return { ok: false as const, code: 'missing_reference' as const };
    const current = (await readItem(client, MEDIA, input.id))!;
    if (snapshotToken(current) !== input.token) return conflictFromHistory(client, MEDIA.entityType, input.id, { by: rows[0].updated_by, at: rows[0].updated_at });
    const deleted = snapshot.row.deleted_at != null;
    if (deleted) {
      const uses = await mediaUsage(client, input.id);
      if (uses.length > 0) return { ok: false as const, code: 'in_use' as const, uses };
    }
    await writeItem(client, MEDIA, { v: 1, row: snapshot.row, i18n: snapshot.i18n }, actor.id);
    await client.query('UPDATE media SET deleted_at = CASE WHEN $2 THEN coalesce(deleted_at, now()) END WHERE id = $1::uuid', [input.id, deleted]);
    const after = await readItem(client, MEDIA, input.id);
    await insertAudit(client, actor, { action: 'restore', entityType: 'media', entityId: input.id, before: current, after: after && { ...after, meta: { restored_from: input.auditId } } });
    return { ok: true as const, data: null };
  });
}

/**
 * Code rule 2: every content save that points a row at files calls this in
 * its transaction. The files must be live, and stay live until the save
 * commits (FOR KEY SHARE blocks a concurrent deleteMedia). Returns the ids
 * that are not.
 */
export async function assertLiveMedia(client: PoolClient, ids: readonly string[], kind?: 'image' | 'pdf'): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { rows } = await client.query<{ id: string }>(
    `SELECT id::text FROM media WHERE id = ANY ($1::uuid[]) AND deleted_at IS NULL
        ${kind === 'pdf' ? `AND content_type = 'application/pdf'` : kind === 'image' ? `AND content_type <> 'application/pdf'` : ''}
      ORDER BY id FOR KEY SHARE`,
    [unique],
  );
  const live = new Set(rows.map((r) => r.id));
  return unique.filter((id) => !live.has(id));
}

/**
 * C7: a content restore whose version points at files in the trash takes
 * them out of it, in the restore's transaction, each with its own `media`
 * audit row (action 'restore'). Returns the ids that have no row left (purged
 * by the sweep): that version cannot come back (missing_reference).
 */
export async function reviveMedia(client: PoolClient, actor: AuditActor, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { rows } = await client.query<{ id: string; deleted: boolean }>(
    'SELECT id::text, deleted_at IS NOT NULL AS deleted FROM media WHERE id = ANY ($1::uuid[]) ORDER BY id FOR UPDATE',
    [unique],
  );
  const missing = unique.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) return missing;
  for (const { id } of rows.filter((r) => r.deleted)) {
    const before = await readItem(client, MEDIA, id);
    await client.query('UPDATE media SET deleted_at = NULL, updated_at = now(), updated_by = $2 WHERE id = $1::uuid', [id, actor.id]);
    await insertAudit(client, actor, { action: 'restore', entityType: 'media', entityId: id, before, after: await readItem(client, MEDIA, id) });
  }
  return [];
}
