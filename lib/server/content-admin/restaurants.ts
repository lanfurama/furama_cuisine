import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { detailPageErrors, followRename, limitError } from '@/lib/admin/content-rules';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy, type Conflict } from '@/lib/server/booking/config';
import type { Db } from '@/lib/server/booking/rules';
import { assertLiveMedia, MEDIA, reviveMedia } from '@/lib/server/media/library';
import { getAuditRow } from './history';
import { makeListEditor, MEDIA_GONE } from './list-editor';
import {
  isForeignKeyViolation,
  lockList,
  orderToken,
  readItem,
  snapshotToken,
  uniqueViolation,
  upsertTranslation,
  writeItem,
  type I18nRow,
  type ItemDef,
  type ItemSnapshot,
  type Row,
} from './snapshot';

/*
 * The restaurant's content editor (spec §7.2 /admin/restaurants/[id]): the
 * restaurant row's content columns, its restaurant_i18n rows, its cuisines and
 * its highlights (+ their i18n), saved and restored as one aggregate in one
 * transaction with one audit row (spec §7.4, §7.5). The booking columns
 * (booking_enabled, the overrides) belong to the phase-4 screen and are never
 * in these snapshots, so a restore cannot undo a booking change, and a
 * booking save is no conflict here (R2: the token is the content's hash).
 *
 * Rules SQL cannot hold, checked here on a save and on a restore alike (code
 * rule 5): a page needs a portrait and an EN story (spec §6.4); a restaurant
 * guests see needs its card picture (also CHECK restaurants_published_card)
 * and an EN type (R22); at most 5 highlights shown (spec §6.5); one menu per
 * language, a file or a link (also CHECK restaurant_i18n_one_menu); the slug
 * is unique. Every file it points at is live (code rule 2: assertLiveMedia,
 * covering the aggregate's own columns that ItemDef.media cannot: the menu
 * PDF and the highlights' pictures, Part 2 risk 20); a restore takes a
 * trashed one out of the trash (C7). R19: the card's alt follows a rename,
 * audited as the file's own `media` row (C6).
 *
 * The list (spec §7.2 /admin/restaurants, A11): "Thêm nhà hàng" creates a
 * hidden draft whose id is its slug and never changes (R22); a restaurant is
 * shown or hidden, archived or brought back, never deleted (F10:
 * reservations reference it with no action); the list's order is a
 * makeListEditor reorder with its History. Showing, archiving and their
 * restores pass the same rules as a save, and say when guest visibility
 * changed (the action then expires booking-rules:<id>).
 */

export const RESTAURANT: ItemDef = {
  entityType: 'restaurants',
  table: 'restaurants',
  idType: 'text',
  columns: [
    'name',
    'slug',
    'destination_id',
    'card_image_id',
    'detail_image_id',
    'og_image_id',
    'phone_e164',
    'phone_display',
    'map_url',
    'has_detail_page',
    'is_published',
    'archived_at',
  ],
  i18n: {
    table: 'restaurant_i18n',
    fk: 'restaurant_id',
    columns: ['type_label', 'detail_kicker', 'story_label', 'story', 'highlights_title', 'menu_pdf_media_id', 'menu_pdf_url', 'seo_title', 'seo_description'],
  },
  tables: ['restaurants', 'restaurant_i18n', 'restaurant_cuisines', 'restaurant_highlights', 'restaurant_highlight_i18n'],
};

export const HIGHLIGHT: ItemDef = {
  entityType: 'restaurant_highlights',
  table: 'restaurant_highlights',
  idType: 'bigint',
  columns: ['restaurant_id', 'image_id', 'sort_order', 'is_published'],
  i18n: { table: 'restaurant_highlight_i18n', fk: 'highlight_id', columns: ['title', 'detail'] },
  tables: ['restaurant_highlights', 'restaurant_highlight_i18n'],
};

/** What audit_log keeps for a restaurant: the item plus its two child lists. */
export type RestaurantSnapshot = ItemSnapshot & {
  cuisines: { cuisine_id: string; sort_order: number }[];
  highlights: ItemSnapshot[];
};

type Translated = Record<string, string | null>;

export type HighlightInput = { id: string | null; imageId: string; isPublished: boolean; title: Translated; detail: Translated };

export type RestaurantInput = {
  name: string;
  slug: string;
  destinationId: string;
  isPublished: boolean;
  hasDetailPage: boolean;
  cardImageId: string | null;
  detailImageId: string | null;
  ogImageId: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  mapUrl: string | null;
  typeLabel: Translated;
  detailKicker: Translated;
  storyLabel: Translated;
  story: Translated;
  highlightsTitle: Translated;
  menuPdfMediaId: Translated;
  menuPdfUrl: Translated;
  seoTitle: Translated;
  seoDescription: Translated;
  /** Cuisine ids in display order. */
  cuisines: string[];
  /** Every highlight in display order; one left out is deleted. */
  highlights: HighlightInput[];
};

type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };
type Fail = Conflict | Invalid | { ok: false; code: 'not_found' } | { ok: false; code: 'missing_reference' };
/** What the Server Action needs for its tags: media when R19 moved an alt, booking-rules when guests' view of it changed (shown, archived). */
export type RestaurantSaved = { altChanged: boolean; visibilityChanged: boolean };
export type RestaurantResult = { ok: true; data: RestaurantSaved } | Fail;

// ── reads ─────────────────────────────────────────────────────────────────

export async function readRestaurant(db: Db, id: string): Promise<RestaurantSnapshot | null> {
  const row = `jsonb_build_object('id', r.id, ${RESTAURANT.columns.map((c) => `'${c}', r.${c}`).join(', ')})`;
  const { rows } = await db.query<{ row: Row; i18n: I18nRow[]; cuisines: RestaurantSnapshot['cuisines']; highlights: ItemSnapshot[] }>(
    `SELECT ${row} AS row,
            coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.locale) FROM restaurant_i18n t WHERE t.restaurant_id = r.id), '[]'::jsonb) AS i18n,
            coalesce((SELECT jsonb_agg(jsonb_build_object('cuisine_id', rc.cuisine_id, 'sort_order', rc.sort_order) ORDER BY rc.sort_order, rc.cuisine_id)
                        FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id), '[]'::jsonb) AS cuisines,
            coalesce((SELECT jsonb_agg(jsonb_build_object(
                               'v', 1, 'row', to_jsonb(h),
                               'i18n', coalesce((SELECT jsonb_agg(to_jsonb(ht) ORDER BY ht.locale) FROM restaurant_highlight_i18n ht WHERE ht.highlight_id = h.id), '[]'::jsonb))
                             ORDER BY h.sort_order, h.id)
                        FROM restaurant_highlights h WHERE h.restaurant_id = r.id), '[]'::jsonb) AS highlights
       FROM restaurants r
      WHERE r.id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { v: 1, row: r.row, i18n: r.i18n, cuisines: r.cuisines, highlights: r.highlights } : null;
}

const enOf = (rows: readonly I18nRow[], col: string) => (rows.find((r) => r.locale === 'en')?.[col] as string | null | undefined) ?? null;

export function restaurantValues(s: RestaurantSnapshot): RestaurantInput {
  const r = s.row;
  const t = (col: string) => ({ en: enOf(s.i18n, col) });
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    name: String(r.name),
    slug: String(r.slug),
    destinationId: String(r.destination_id),
    isPublished: Boolean(r.is_published),
    hasDetailPage: Boolean(r.has_detail_page),
    cardImageId: str(r.card_image_id),
    detailImageId: str(r.detail_image_id),
    ogImageId: str(r.og_image_id),
    phoneE164: str(r.phone_e164),
    phoneDisplay: str(r.phone_display),
    mapUrl: str(r.map_url),
    typeLabel: t('type_label'),
    detailKicker: t('detail_kicker'),
    storyLabel: t('story_label'),
    story: t('story'),
    highlightsTitle: t('highlights_title'),
    menuPdfMediaId: t('menu_pdf_media_id'),
    menuPdfUrl: t('menu_pdf_url'),
    seoTitle: t('seo_title'),
    seoDescription: t('seo_description'),
    cuisines: s.cuisines.map((c) => c.cuisine_id),
    highlights: s.highlights.map((h) => ({
      id: String(h.row.id),
      imageId: String(h.row.image_id),
      isPublished: Boolean(h.row.is_published),
      title: { en: enOf(h.i18n, 'title') },
      detail: { en: enOf(h.i18n, 'detail') },
    })),
  };
}

export type RestaurantEditor = {
  snapshot: RestaurantSnapshot;
  token: string;
  values: RestaurantInput;
  updatedAt: Date;
  updatedBy: string | null;
  /** The spec §6.4 fallbacks, for the page's warnings: the restaurant's own, else its destination's. */
  hasPhone: boolean;
  hasMap: boolean;
};

export async function getRestaurantEditor(db: Db, id: string): Promise<RestaurantEditor | null> {
  const snapshot = await readRestaurant(db, id);
  if (!snapshot) return null;
  const { rows } = await db.query<{ updated_at: Date; updated_by: string | null; has_phone: boolean; has_map: boolean }>(
    `SELECT r.updated_at, s.name AS updated_by,
            (r.phone_e164 IS NOT NULL OR d.phone_e164 IS NOT NULL) AS has_phone,
            (r.map_url IS NOT NULL OR d.map_url IS NOT NULL) AS has_map
       FROM restaurants r
       JOIN destinations d ON d.id = r.destination_id
       LEFT JOIN staff_user s ON s.id = r.updated_by
      WHERE r.id = $1`,
    [id],
  );
  return {
    snapshot,
    token: snapshotToken(snapshot),
    values: restaurantValues(snapshot),
    updatedAt: rows[0].updated_at,
    updatedBy: rows[0].updated_by,
    hasPhone: rows[0].has_phone,
    hasMap: rows[0].has_map,
  };
}

export async function listCuisineOptions(db: Db): Promise<{ id: string; label: string }[]> {
  const { rows } = await db.query<{ id: string; label: string }>(
    `SELECT c.id, coalesce(ci.label, c.id) AS label FROM cuisines c
       LEFT JOIN cuisine_i18n ci ON ci.cuisine_id = c.id AND ci.locale = 'en'
      ORDER BY c.sort_order, c.id`,
  );
  return rows;
}

// ── writes ────────────────────────────────────────────────────────────────

async function lockRestaurant(client: PoolClient, id: string, token: string): Promise<{ snapshot: RestaurantSnapshot } | Fail> {
  const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>('SELECT updated_by, updated_at FROM restaurants WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) return { ok: false, code: 'not_found' };
  const snapshot = (await readRestaurant(client, id))!;
  if (snapshotToken(snapshot) !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return { snapshot };
}

const failed = (x: { snapshot: RestaurantSnapshot } | Fail): x is Fail => 'ok' in x;

/** Guests see it: shown and not archived (the catalogue, its page, its offers and online booking all ask this). */
const seen = (row: Row) => Boolean(row.is_published) && row.archived_at == null;

/** A version about to be written, as the rules see it (a form's or a snapshot's). */
type Version = {
  slug: string;
  isPublished: boolean;
  hasDetailPage: boolean;
  cardImageId: string | null;
  detailImageId: string | null;
  typeEn: string | null;
  storyEn: string | null;
  menuFileEn: string | null;
  menuLinkEn: string | null;
  shownHighlights: number;
};

/** The rules a save and a restore both apply to the state they would write (code rule 5). */
async function ruleErrors(client: PoolClient, id: string, v: Version): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = { ...detailPageErrors({ hasDetailPage: v.hasDetailPage, detailImageId: v.detailImageId, storyEn: v.storyEn }) };
  if (v.isPublished && !v.cardImageId) errors.cardImageId = ['Nhà hàng đang hiện trên web cần ảnh thẻ.'];
  if (v.isPublished && !v.typeEn?.trim()) errors.typeLabel = ['Nhà hàng đang hiện trên web cần loại nhà hàng (tiếng Anh).'];
  if (v.menuFileEn && v.menuLinkEn) errors.menuPdfUrl = ['Chọn một: file PDF trong thư viện hoặc link thực đơn, không cả hai.'];
  const limit = limitError('highlights', v.shownHighlights);
  if (limit) errors.highlights = [limit];
  const { rowCount } = await client.query('SELECT 1 FROM restaurants WHERE slug = $1 AND id <> $2', [v.slug, id]);
  if (rowCount) errors.slug = ['Đường dẫn này đã có nhà hàng khác dùng.'];
  return errors;
}

/** The files a version points at, by the form field that names them. */
function filesOf(v: { cardImageId: string | null; detailImageId: string | null; ogImageId: string | null; menuFileEn: string | null; highlightImages: string[] }) {
  return [
    ...(['cardImageId', 'detailImageId', 'ogImageId'] as const).flatMap((field) => (v[field] ? [{ field, id: v[field]!, kind: 'image' as const }] : [])),
    ...(v.menuFileEn ? [{ field: 'menuPdfMediaId', id: v.menuFileEn, kind: 'pdf' as const }] : []),
    ...v.highlightImages.map((id) => ({ field: 'highlights', id, kind: 'image' as const })),
  ];
}

/** Code rule 2: each file is live (and of its kind), and stays so until the save commits. */
async function deadFiles(client: PoolClient, files: ReturnType<typeof filesOf>): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  for (const kind of ['image', 'pdf'] as const) {
    const dead = await assertLiveMedia(
      client,
      files.filter((f) => f.kind === kind).map((f) => f.id),
      kind,
    );
    for (const f of files.filter((x) => x.kind === kind && dead.includes(x.id))) errors[f.field] = [MEDIA_GONE];
  }
  return errors;
}

/**
 * R19: while the card's EN alt is still the old name, it becomes the new
 * one, audited as the file's own History row (entity `media`, the whole file
 * as an ItemSnapshot, C6); true when it moved, so the action also expires
 * `media`.
 */
async function followCardAlt(client: PoolClient, actor: AuditActor, before: Row, after: { name: string; cardImageId: string | null }): Promise<boolean> {
  if (!after.cardImageId || String(before.card_image_id) !== after.cardImageId) return false;
  const { rows } = await client.query<{ alt: string }>("SELECT alt FROM media_i18n WHERE media_id = $1::uuid AND locale = 'en' FOR UPDATE", [after.cardImageId]);
  const alt = followRename(rows[0]?.alt ?? null, String(before.name), after.name);
  if (alt === null) return false;
  const file = await readItem(client, MEDIA, after.cardImageId);
  await upsertTranslation(client, MEDIA, after.cardImageId, 'en', { alt }, actor.id);
  await insertAudit(client, actor, { action: 'update', entityType: 'media', entityId: after.cardImageId, before: file, after: await readItem(client, MEDIA, after.cardImageId) });
  return true;
}

async function replaceCuisines(client: PoolClient, id: string, cuisines: readonly string[]): Promise<void> {
  await client.query('DELETE FROM restaurant_cuisines WHERE restaurant_id = $1', [id]);
  for (const [index, cuisineId] of cuisines.entries()) {
    await client.query('INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id, sort_order) VALUES ($1, $2, $3)', [id, cuisineId, (index + 1) * 10]);
  }
}

function invalid(errors: Record<string, string[]>): Invalid | null {
  return Object.keys(errors).length ? { ok: false, code: 'invalid', fieldErrors: errors } : null;
}

export async function saveRestaurantContent(pool: Pool, actor: AuditActor, id: string, token: string, input: RestaurantInput): Promise<RestaurantResult> {
  return withTransaction(pool, async (client): Promise<RestaurantResult> => {
    const locked = await lockRestaurant(client, id, token);
    if (failed(locked)) return locked;
    const before = locked.snapshot;
    const known = new Set(before.highlights.map((h) => String(h.row.id)));
    // A highlight id this restaurant does not have: the page is older than a save that removed it.
    if (input.highlights.some((h) => h.id !== null && !known.has(h.id))) return { ok: false, code: 'not_found' };

    const menuFileEn = input.menuPdfMediaId.en ?? null;
    const errors = await ruleErrors(client, id, {
      slug: input.slug,
      isPublished: input.isPublished,
      hasDetailPage: input.hasDetailPage,
      cardImageId: input.cardImageId,
      detailImageId: input.detailImageId,
      typeEn: input.typeLabel.en ?? null,
      storyEn: input.story.en ?? null,
      menuFileEn,
      menuLinkEn: input.menuPdfUrl.en ?? null,
      shownHighlights: input.highlights.filter((h) => h.isPublished).length,
    });
    const { rows: knownCuisines } = await client.query<{ id: string }>('SELECT id FROM cuisines WHERE id = ANY($1::text[])', [input.cuisines]);
    if (knownCuisines.length !== new Set(input.cuisines).size) errors.cuisines = ['Có ẩm thực không còn nữa. Hãy tải lại trang.'];
    const refused =
      invalid(errors) ??
      invalid(
        await deadFiles(
          client,
          filesOf({ ...input, menuFileEn, highlightImages: input.highlights.map((h) => h.imageId) }),
        ),
      );
    if (refused) return refused;

    await client.query(
      `UPDATE restaurants
          SET name = $2, slug = $3, destination_id = $4, card_image_id = $5::uuid, detail_image_id = $6::uuid, og_image_id = $7::uuid,
              phone_e164 = $8, phone_display = $9, map_url = $10, has_detail_page = $11, is_published = $12,
              updated_at = now(), updated_by = $13
        WHERE id = $1`,
      [
        id,
        input.name,
        input.slug,
        input.destinationId,
        input.cardImageId,
        input.detailImageId,
        input.ogImageId,
        input.phoneE164,
        input.phoneDisplay,
        input.mapUrl,
        input.hasDetailPage,
        input.isPublished,
        actor.id,
      ],
    );
    for (const locale of Object.keys(input.typeLabel)) {
      await upsertTranslation(
        client,
        RESTAURANT,
        id,
        locale,
        {
          type_label: input.typeLabel[locale] ?? null,
          detail_kicker: input.detailKicker[locale] ?? null,
          story_label: input.storyLabel[locale] ?? null,
          story: input.story[locale] ?? null,
          highlights_title: input.highlightsTitle[locale] ?? null,
          menu_pdf_media_id: input.menuPdfMediaId[locale] ?? null,
          menu_pdf_url: input.menuPdfUrl[locale] ?? null,
          seo_title: input.seoTitle[locale] ?? null,
          seo_description: input.seoDescription[locale] ?? null,
        },
        actor.id,
      );
    }
    await replaceCuisines(client, id, input.cuisines);

    const keep = input.highlights.flatMap((h) => (h.id ? [h.id] : []));
    await client.query('DELETE FROM restaurant_highlights WHERE restaurant_id = $1 AND NOT (id = ANY ($2::bigint[]))', [id, keep]);
    for (const [index, h] of input.highlights.entries()) {
      const values = [h.imageId, (index + 1) * 10, h.isPublished, actor.id];
      let highlightId = h.id;
      if (highlightId) {
        await client.query(
          `UPDATE restaurant_highlights SET image_id = $1::uuid, sort_order = $2, is_published = $3, updated_at = now(), updated_by = $4
            WHERE id = $5::bigint AND restaurant_id = $6`,
          [...values, highlightId, id],
        );
      } else {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO restaurant_highlights (image_id, sort_order, is_published, updated_by, restaurant_id)
           VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id::text`,
          [...values, id],
        );
        highlightId = rows[0].id;
      }
      for (const locale of Object.keys(h.title)) {
        await upsertTranslation(client, HIGHLIGHT, highlightId, locale, { title: h.title[locale] ?? null, detail: h.detail[locale] ?? null }, actor.id);
      }
    }

    const altChanged = await followCardAlt(client, actor, before.row, { name: input.name, cardImageId: input.cardImageId });
    await insertAudit(client, actor, { action: 'update', entityType: RESTAURANT.entityType, entityId: id, before, after: await readRestaurant(client, id) });
    return { ok: true, data: { altChanged, visibilityChanged: seen(before.row) !== seen({ ...before.row, is_published: input.isPublished }) } };
  }).catch((err) => mapWriteError(err));
}

function mapWriteError(err: unknown): RestaurantResult {
  if (isForeignKeyViolation(err)) return { ok: false, code: 'missing_reference' };
  if (uniqueViolation(err) === 'restaurants_slug_key') return { ok: false, code: 'invalid', fieldErrors: { slug: ['Đường dẫn này đã có nhà hàng khác dùng.'] } };
  throw err;
}

function isRestaurantSnapshot(value: unknown, id: string): value is RestaurantSnapshot {
  const s = value as RestaurantSnapshot | null;
  return !!s && s.v === 1 && String(s.row?.id) === id && Array.isArray(s.i18n) && Array.isArray(s.cuisines) && Array.isArray(s.highlights);
}

/** "Khôi phục phiên bản này" for a restaurant: the whole aggregate as it was, through the same rules (spec §7.5). */
export async function restoreRestaurant(
  pool: Pool,
  actor: AuditActor,
  input: { id: string; auditId: string; side: 'before' | 'after'; token: string },
): Promise<RestaurantResult> {
  return withTransaction(pool, async (client): Promise<RestaurantResult> => {
    const audit = await getAuditRow(client, input.auditId);
    const snapshot = audit?.[input.side];
    if (!audit || audit.entity_type !== RESTAURANT.entityType || audit.entity_id !== input.id || !isRestaurantSnapshot(snapshot, input.id)) {
      return { ok: false, code: 'not_found' };
    }
    const locked = await lockRestaurant(client, input.id, input.token);
    if (failed(locked)) return locked;
    const current = locked.snapshot;
    const row = snapshot.row;
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const menuFileEn = str(enOf(snapshot.i18n, 'menu_pdf_media_id'));
    const refused = invalid(
      await ruleErrors(client, input.id, {
        slug: String(row.slug),
        isPublished: Boolean(row.is_published),
        hasDetailPage: Boolean(row.has_detail_page),
        cardImageId: str(row.card_image_id),
        detailImageId: str(row.detail_image_id),
        typeEn: enOf(snapshot.i18n, 'type_label'),
        storyEn: enOf(snapshot.i18n, 'story'),
        menuFileEn,
        menuLinkEn: enOf(snapshot.i18n, 'menu_pdf_url'),
        shownHighlights: snapshot.highlights.filter((h) => h.row.is_published).length,
      }),
    );
    if (refused) return refused;
    // C7: files this version shows that are now in the trash come back with it; a purged one cannot.
    const files = [
      row.card_image_id,
      row.detail_image_id,
      row.og_image_id,
      ...snapshot.i18n.map((t) => t.menu_pdf_media_id),
      ...snapshot.highlights.map((h) => h.row.image_id),
    ].flatMap((v) => (typeof v === 'string' && v ? [v] : []));
    if ((await reviveMedia(client, actor, files)).length > 0) return { ok: false, code: 'missing_reference' };

    await writeItem(client, RESTAURANT, { v: 1, row, i18n: snapshot.i18n }, actor.id);
    const { rows: cuisines } = await client.query<{ id: string }>('SELECT id FROM cuisines WHERE id = ANY($1::text[])', [snapshot.cuisines.map((c) => c.cuisine_id)]);
    const live = new Set(cuisines.map((c) => c.id));
    await replaceCuisines(
      client,
      input.id,
      snapshot.cuisines.map((c) => c.cuisine_id).filter((c) => live.has(c)),
    );
    const keep = snapshot.highlights.map((h) => String(h.row.id));
    await client.query('DELETE FROM restaurant_highlights WHERE restaurant_id = $1 AND NOT (id = ANY ($2::bigint[]))', [input.id, keep]);
    for (const h of snapshot.highlights) {
      // A highlight that moved to another restaurant since cannot: its row says which restaurant it is.
      await writeItem(client, HIGHLIGHT, { v: 1, row: { ...h.row, restaurant_id: input.id }, i18n: h.i18n }, actor.id);
    }
    const altChanged = await followCardAlt(client, actor, current.row, { name: String(row.name), cardImageId: str(row.card_image_id) });
    const after = await readRestaurant(client, input.id);
    await insertAudit(client, actor, {
      action: 'restore',
      entityType: RESTAURANT.entityType,
      entityId: input.id,
      before: current,
      after: after && { ...after, meta: { restored_from: input.auditId } },
    });
    return { ok: true, data: { altChanged, visibilityChanged: seen(current.row) !== seen(row) } };
  }).catch((err) => mapWriteError(err));
}

// ── the list (A11) ────────────────────────────────────────────────────────

/** A snapshot's version as the rules read it (shared by showing, archiving and their restores). */
function versionOf(snapshot: { row: Row; i18n: readonly I18nRow[]; highlights: readonly ItemSnapshot[] }): Version {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    slug: String(snapshot.row.slug),
    isPublished: Boolean(snapshot.row.is_published),
    hasDetailPage: Boolean(snapshot.row.has_detail_page),
    cardImageId: str(snapshot.row.card_image_id),
    detailImageId: str(snapshot.row.detail_image_id),
    typeEn: enOf(snapshot.i18n, 'type_label'),
    storyEn: enOf(snapshot.i18n, 'story'),
    menuFileEn: str(enOf(snapshot.i18n, 'menu_pdf_media_id')),
    menuLinkEn: enOf(snapshot.i18n, 'menu_pdf_url'),
    shownHighlights: snapshot.highlights.filter((h) => h.row.is_published).length,
  };
}

export type NewRestaurant = { name: string; slug: string; destinationId: string };

/**
 * "Thêm nhà hàng" (R22): a hidden draft, its id the slug (fixed for good:
 * bookings will reference it), online booking off, no service period. It
 * shows once its editor gives it a card picture and a type.
 */
export async function createRestaurant(pool: Pool, actor: AuditActor, input: NewRestaurant): Promise<{ ok: true; data: { id: string } } | Invalid> {
  return withTransaction(pool, async (client): Promise<{ ok: true; data: { id: string } } | Invalid> => {
    await lockList(client, 'restaurants');
    const { rowCount: taken } = await client.query('SELECT 1 FROM restaurants WHERE id = $1 OR slug = $1', [input.slug]);
    if (taken) return { ok: false, code: 'invalid', fieldErrors: { slug: ['Đường dẫn này đã có nhà hàng khác dùng.'] } };
    const { rowCount: known } = await client.query('SELECT 1 FROM destinations WHERE id = $1', [input.destinationId]);
    if (!known) return { ok: false, code: 'invalid', fieldErrors: { destinationId: ['Điểm đến này không còn nữa. Hãy tải lại trang.'] } };
    await client.query(
      `INSERT INTO restaurants (id, name, slug, destination_id, is_published, has_detail_page, booking_enabled, sort_order, updated_by)
       VALUES ($1, $2, $1, $3, false, false, false, (SELECT coalesce(max(sort_order), 0) + 10 FROM restaurants), $4)`,
      [input.slug, input.name, input.destinationId, actor.id],
    );
    await insertAudit(client, actor, { action: 'create', entityType: RESTAURANT.entityType, entityId: input.slug, before: null, after: await readRestaurant(client, input.slug) });
    return { ok: true, data: { id: input.slug } };
  });
}

/** One switch of the list (shown, archived), through the rules of the version it leaves (code rule 5). */
async function switchRestaurant(pool: Pool, actor: AuditActor, input: { id: string; token: string }, set: (row: Row) => Row, sql: string, value: boolean): Promise<RestaurantResult> {
  return withTransaction(pool, async (client): Promise<RestaurantResult> => {
    const locked = await lockRestaurant(client, input.id, input.token);
    if (failed(locked)) return locked;
    const before = locked.snapshot;
    const refused = invalid(await ruleErrors(client, input.id, versionOf({ ...before, row: set(before.row) })));
    if (refused) return refused;
    await client.query(`UPDATE restaurants SET ${sql}, updated_at = now(), updated_by = $3 WHERE id = $1`, [input.id, value, actor.id]);
    const after = (await readRestaurant(client, input.id))!;
    await insertAudit(client, actor, { action: 'update', entityType: RESTAURANT.entityType, entityId: input.id, before, after });
    return { ok: true, data: { altChanged: false, visibilityChanged: seen(before.row) !== seen(after.row) } };
  });
}

/** "Hiện" / "Ẩn": shown needs its card picture and type (and, with its page on, the page's own rules). */
export function setRestaurantShown(pool: Pool, actor: AuditActor, input: { id: string; token: string; shown: boolean }): Promise<RestaurantResult> {
  return switchRestaurant(pool, actor, input, (row) => ({ ...row, is_published: input.shown }), 'is_published = $2', input.shown);
}

/** "Lưu trữ" / "Bỏ lưu trữ" (F10: never deleted): archived, it leaves the catalogue, its page, its offers and online booking. */
export function setRestaurantArchived(pool: Pool, actor: AuditActor, input: { id: string; token: string; archived: boolean }): Promise<RestaurantResult> {
  return switchRestaurant(
    pool,
    actor,
    input,
    (row) => ({ ...row, archived_at: input.archived ? new Date().toISOString() : null }),
    'archived_at = CASE WHEN $2 THEN now() END',
    input.archived,
  );
}

/** The catalogue's order (the home page's cards, spec §7.2), with its History: makeListEditor's reorder on the restaurants table. */
const order = makeListEditor<never>(RESTAURANT, { listKey: 'restaurants', toRow: () => ({}) });
export const reorderRestaurants = order.reorder;
export const restoreRestaurantOrder = order.restoreOrder;

export type RestaurantListItem = {
  id: string;
  name: string;
  slug: string;
  /** Its destination's name in the default language (the column `destination` is phase 1's: R10). */
  destinationName: string;
  isPublished: boolean;
  archived: boolean;
  hasDetailPage: boolean;
  card: { url: string; width: number | null; height: number | null } | null;
  /** The aggregate's token (its show and archive buttons). */
  token: string;
};

/** Every restaurant in the catalogue's order, archived ones included, and the list's token (the ids in order). */
export async function listRestaurantsAdmin(db: Db): Promise<{ items: RestaurantListItem[]; token: string }> {
  const { rows } = await db.query<Omit<RestaurantListItem, 'token' | 'card'> & { url: string | null; width: number | null; height: number | null }>(
    `SELECT r.id, r.name, r.slug, coalesce(dt.name, r.destination_id) AS "destinationName", r.is_published AS "isPublished",
            r.archived_at IS NOT NULL AS archived, r.has_detail_page AS "hasDetailPage", m.url, m.width, m.height
       FROM restaurants r
       LEFT JOIN destination_i18n dt ON dt.destination_id = r.destination_id AND dt.locale = (SELECT code FROM locales WHERE is_default)
       LEFT JOIN media m ON m.id = r.card_image_id
      ORDER BY r.sort_order, r.id`,
  );
  const items = await Promise.all(
    rows.map(async ({ url, width, height, ...r }) => ({
      ...r,
      card: url ? { url, width, height } : null,
      token: snapshotToken(await readRestaurant(db, r.id)),
    })),
  );
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
