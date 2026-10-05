import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { listStoriesAdmin, STORY } from '@/lib/server/content-admin/stories';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { DeletedList, enOf } from '../../_kit/DeletedList';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { ItemList } from '../../_kit/ItemList';
import { StringsPanel } from '../_ui/StringsPanel';
import { deleteStoryAction, reorderStoriesAction, restoreStoryAction, restoreStoryOrderAction, toggleStoryAction } from './actions';
import { StoryForm } from './StoryForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Stories' };

/** The History tab's names for a card's fields (spec §7.5), in form order. */
const LABELS = {
  title: 'Tiêu đề',
  category: 'Chuyên mục',
  published_on: 'Ngày đăng',
  href: 'Link bài viết',
  image_id: 'Ảnh thẻ',
  is_published: 'Hiện/ẩn',
};

/*
 * Spec §7.2 content/stories: the cards in their guest order (at most 4
 * shown), each card's form and History, the deleted ones to bring back, the
 * order's History, and the section's words (stories.*, plan 7A A3).
 */
export default async function StoriesPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory, images] = await Promise.all([
    listStoriesAdmin(pool),
    listDeleted(pool, STORY),
    listHistory(pool, 'stories', null, 10),
    listMediaOptions(pool, 'image'),
  ]);
  const histories = await Promise.all(items.map((s) => listHistory(pool, 'stories', s.id, 10)));
  const upload = { prefix: envPrefix(), configured: isBlobConfigured() };
  const shown = items.filter((i) => i.isPublished).length;
  const thumbOf = (id: string) => images.find((i) => i.id === id) ?? null;

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Stories</h1>
      <p className="a-lede">Thẻ bài viết của mục Stories ở trang chủ, theo thứ tự khách thấy, và chữ của mục. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.</p>

      <section className="a-section-card" aria-labelledby="stories-list-title">
        <h2 id="stories-list-title">Các thẻ</h2>
        <ItemList
          label="Thứ tự Stories"
          noun="câu chuyện"
          items={items.map((s) => ({
            id: s.id,
            name: s.name,
            isPublished: s.isPublished,
            token: s.token,
            meta: [s.values.category.en, s.values.publishedOn].filter(Boolean).join(' · ') || undefined,
            thumb: thumbOf(s.values.imageId),
          }))}
          listToken={token}
          limit={LIMITS.stories.max}
          warnings={limitWarnings('stories', shown)}
          empty="Chưa có thẻ nào."
          reorder={reorderStoriesAction}
          toggle={toggleStoryAction}
          remove={deleteStoryAction}
          details={Object.fromEntries(
            items.map((s, i) => [
              s.id,
              <div key={s.id}>
                <StoryForm id={s.id} token={s.token} values={s.values} images={images} upload={upload} label={`Câu chuyện “${s.name}”`} />
                <HistoryPanel
                  title={`Lịch sử: ${s.name}`}
                  headingId={`story-${s.id}-history`}
                  entries={histories[i]}
                  currentToken={s.token}
                  recordId={s.id}
                  labels={LABELS}
                  restore={restoreStoryAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm câu chuyện</h3>
        <StoryForm
          id={null}
          token={token}
          images={images}
          upload={upload}
          label="Thêm câu chuyện"
          values={{ imageId: '', href: '', publishedOn: null, isPublished: shown < LIMITS.stories.max, category: { en: null }, title: { en: null }, localHref: { en: null } }}
        />
      </section>

      <DeletedList
        headingId="stories-deleted"
        empty="Không có câu chuyện nào bị xóa."
        deleted={deleted}
        name={(before, id) => enOf(before, 'title') ?? `Câu chuyện ${id}`}
        restore={restoreStoryAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự Stories"
        headingId="stories-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="stories"
        labels={{}}
        restore={restoreStoryOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="stories-copy">
        <h2 id="stories-copy">Chữ của mục Stories</h2>
        <StringsPanel screen="stories" title="Stories" />
      </section>
    </>
  );
}
