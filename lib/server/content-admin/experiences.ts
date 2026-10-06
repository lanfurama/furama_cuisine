import 'server-only';
import type { Db } from '@/lib/server/booking/rules';
import { enTitleRequired, makeListEditor } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';
import { localeTexts } from './form-locales';

/*
 * The Experiences rows (spec §7.2 content/experiences, §6.5 "Experiences
 * 1–5"): a title, a blurb and a link each, beside the section's picture
 * (sections[experiences], the sections screen's). Every write goes through
 * makeListEditor: at most 5 shown (R4: fewer than 1 only warns), the EN title
 * (the loader drops a row without one). The link is https or nothing
 * (CHECK experiences.link_url); without one the row points at its own
 * section, as before phase 6 (R25). The owner's links are content he enters
 * here.
 */

export const EXPERIENCE: ItemDef = {
  entityType: 'experiences',
  table: 'experiences',
  idType: 'bigint',
  columns: ['link_url', 'sort_order', 'is_published'],
  i18n: { table: 'experience_i18n', fk: 'experience_id', columns: ['title', 'blurb'] },
  tables: ['experiences', 'experience_i18n'],
};

export type ExperienceInput = {
  link: string | null;
  isPublished: boolean;
  /** One language per key (the form's tabs, phase 8). */
  title: Record<string, string | null>;
  blurb: Record<string, string | null>;
};

const experiences = makeListEditor<ExperienceInput>(EXPERIENCE, {
  listKey: 'experiences',
  limit: 'experiences',
  toRow: (input) => ({ link_url: input.link, is_published: input.isPublished }),
  toI18n: (input) =>
    Object.fromEntries(Object.keys(input.title).map((locale) => [locale, { title: input.title[locale] ?? null, blurb: input.blurb[locale] ?? null }])),
  validate: enTitleRequired,
});

export const createExperience = experiences.create;
export const updateExperience = experiences.update;
export const setExperiencePublished = experiences.setPublished;
export const reorderExperiences = experiences.reorder;
export const deleteExperience = experiences.remove;
export const restoreExperience = experiences.restore;
export const restoreExperienceOrder = experiences.restoreOrder;

/** The form's values for one row, from its snapshot. */
export function experienceValues(s: ItemSnapshot): ExperienceInput {
  return {
    link: (s.row.link_url as string | null) ?? null,
    isPublished: Boolean(s.row.is_published),
    title: localeTexts(s.i18n, 'title'),
    blurb: localeTexts(s.i18n, 'blurb'),
  };
}

export type ExperienceListItem = { id: string; name: string; isPublished: boolean; token: string; values: ExperienceInput };

/** Every row in its guest order, with its token and form values, and the list's token (the ids in order). */
export async function listExperiencesAdmin(db: Db): Promise<{ items: ExperienceListItem[]; token: string }> {
  const items = (await readItems(db, EXPERIENCE)).map((s) => {
    const values = experienceValues(s);
    const id = String(s.row.id);
    return { id, name: values.title.en || `Trải nghiệm ${id}`, isPublished: values.isPublished, token: snapshotToken(s), values };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
