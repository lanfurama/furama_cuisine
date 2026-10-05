import 'server-only';
import type { Db } from '@/lib/server/booking/rules';
import { enTitleRequired, makeListEditor } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The Stories cards (spec §7.2 content/stories, §6.5 "Stories tối đa 4"):
 * links out to articles. A card is its picture, its article link (one for
 * every language, or one per language: story_i18n.href), its date, its
 * category and its title. Every write goes through makeListEditor: at most 4
 * shown (R4), the EN title (the loader drops a card without one), the
 * picture live (code rule 2). The kicker is "Category · date", joined from
 * the parts that exist (lib/content/format.ts storyKicker, L7-7).
 */

export const STORY: ItemDef = {
  entityType: 'stories',
  table: 'stories',
  idType: 'bigint',
  columns: ['image_id', 'href', 'published_on', 'sort_order', 'is_published'],
  i18n: { table: 'story_i18n', fk: 'story_id', columns: ['category', 'title', 'href'] },
  tables: ['stories', 'story_i18n'],
  media: [{ column: 'image_id', kind: 'image', field: 'imageId' }],
};

export type StoryInput = {
  imageId: string;
  href: string;
  publishedOn: string | null;
  isPublished: boolean;
  /** One language per key: the form sends EN only until phase 8 adds its tabs. */
  category: Record<string, string | null>;
  title: Record<string, string | null>;
  /** The article in that language, when it differs from `href`. */
  localHref: Record<string, string | null>;
};

const stories = makeListEditor<StoryInput>(STORY, {
  listKey: 'stories',
  limit: 'stories',
  toRow: (input) => ({ image_id: input.imageId, href: input.href, published_on: input.publishedOn, is_published: input.isPublished }),
  toI18n: (input) =>
    Object.fromEntries(
      Object.keys(input.title).map((locale) => [
        locale,
        { category: input.category[locale] ?? null, title: input.title[locale] ?? null, href: input.localHref[locale] ?? null },
      ]),
    ),
  validate: enTitleRequired,
});

export const createStory = stories.create;
export const updateStory = stories.update;
export const setStoryPublished = stories.setPublished;
export const reorderStories = stories.reorder;
export const deleteStory = stories.remove;
export const restoreStory = stories.restore;
export const restoreStoryOrder = stories.restoreOrder;

/** The form's values for one card, from its snapshot. */
export function storyValues(s: ItemSnapshot): StoryInput {
  const en = s.i18n.find((r) => r.locale === 'en');
  const text = (col: string) => (en?.[col] as string | null | undefined) ?? null;
  return {
    imageId: String(s.row.image_id),
    href: String(s.row.href),
    publishedOn: (s.row.published_on as string | null) ?? null,
    isPublished: Boolean(s.row.is_published),
    category: { en: text('category') },
    title: { en: text('title') },
    localHref: { en: text('href') },
  };
}

export type StoryListItem = { id: string; name: string; isPublished: boolean; token: string; values: StoryInput };

/** Every card in its guest order, with its token and form values, and the list's token (the ids in order). */
export async function listStoriesAdmin(db: Db): Promise<{ items: StoryListItem[]; token: string }> {
  const items = (await readItems(db, STORY)).map((s) => {
    const values = storyValues(s);
    const id = String(s.row.id);
    return { id, name: values.title.en || `Câu chuyện ${id}`, isPublished: values.isPublished, token: snapshotToken(s), values };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
