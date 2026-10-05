import 'server-only';
import type { PoolClient } from 'pg';
import { FIRST_SLIDE_NEEDS_CROP } from '@/lib/admin/content-rules';
import type { Db } from '@/lib/server/booking/rules';
import { makeListEditor, type ListFailure } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef } from './snapshot';

/*
 * The hero's slides (spec §7.2 content/hero, §6.5 "Hero slides 1–5. Slide 1
 * bắt buộc có ảnh crop cho mobile"). A slide is a picture and, for the first
 * one a guest sees, its phone crop; alt text is the picture's own (edited on
 * the file, R12). Every write goes through makeListEditor: at most 5 shown
 * (R4: fewer than 1 only warns; with none the home page drops its hero and
 * names itself with a hidden <h1>, phase-6 F-A), live files only (code rule
 * 2), and after every write the first slide shown must have its phone crop
 * (checkList: hiding, deleting or reordering can change which slide is first).
 */

export const HERO_SLIDE: ItemDef = {
  entityType: 'hero_slides',
  table: 'hero_slides',
  idType: 'bigint',
  columns: ['image_id', 'image_mobile_id', 'sort_order', 'is_published'],
  tables: ['hero_slides'],
  media: [
    { column: 'image_id', kind: 'image', field: 'imageId' },
    { column: 'image_mobile_id', kind: 'image', field: 'imageMobileId' },
  ],
};

export type SlideInput = { imageId: string; imageMobileId: string | null; isPublished: boolean };

/**
 * The first slide the guest sees (loadHeroSlides: published, its picture
 * live) must carry a live phone crop; no slide shown is allowed.
 */
async function firstSlideHasCrop(client: PoolClient): Promise<ListFailure | null> {
  const { rows } = await client.query<{ crop: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM media mm WHERE mm.id = h.image_mobile_id AND mm.deleted_at IS NULL) AS crop
       FROM hero_slides h JOIN media m ON m.id = h.image_id AND m.deleted_at IS NULL
      WHERE h.is_published
      ORDER BY h.sort_order, h.id
      LIMIT 1`,
  );
  return rows[0] && !rows[0].crop ? { ok: false, code: 'invalid', fieldErrors: { imageMobileId: [FIRST_SLIDE_NEEDS_CROP] } } : null;
}

const slides = makeListEditor<SlideInput>(HERO_SLIDE, {
  listKey: 'hero_slides',
  limit: 'heroSlides',
  toRow: (input) => ({ image_id: input.imageId, image_mobile_id: input.imageMobileId, is_published: input.isPublished }),
  checkList: firstSlideHasCrop,
});

export const createSlide = slides.create;
export const updateSlide = slides.update;
export const setSlidePublished = slides.setPublished;
export const reorderSlides = slides.reorder;
export const deleteSlide = slides.remove;
export const restoreSlide = slides.restore;
export const restoreSlideOrder = slides.restoreOrder;

export type SlideListItem = {
  id: string;
  imageId: string;
  imageMobileId: string | null;
  isPublished: boolean;
  /** The picture's file name, how the screen names the slide ("hero-taya.jpg"). */
  name: string;
  token: string;
};

/** Every slide in its guest order, each with its token, and the list's token (the ids in order). */
export async function listSlidesAdmin(db: Db): Promise<{ items: SlideListItem[]; token: string }> {
  const snapshots = await readItems(db, HERO_SLIDE);
  const ids = snapshots.map((s) => String(s.row.image_id));
  const { rows } = await db.query<{ id: string; pathname: string }>('SELECT id::text, pathname FROM media WHERE id = ANY ($1::uuid[])', [ids]);
  const pathOf = new Map(rows.map((r) => [r.id, r.pathname]));
  const items = snapshots.map((s) => ({
    id: String(s.row.id),
    imageId: String(s.row.image_id),
    imageMobileId: (s.row.image_mobile_id as string | null) ?? null,
    isPublished: Boolean(s.row.is_published),
    name: (pathOf.get(String(s.row.image_id)) ?? '').split('/').pop() ?? '',
    token: snapshotToken(s),
  }));
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
