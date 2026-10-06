import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { formLocales, listStates } from '@/lib/server/content-admin/form-locales';
import { EXPERIENCE, listExperiencesAdmin } from '@/lib/server/content-admin/experiences';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { DeletedList, enOf } from '../../_kit/DeletedList';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { ItemList } from '../../_kit/ItemList';
import { LocaleTabs } from '../../_kit/LocaleTabs';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';
import { deleteExperienceAction, reorderExperiencesAction, restoreExperienceAction, restoreExperienceOrderAction, toggleExperienceAction } from './actions';
import { ExperienceForm } from './ExperienceForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Experiences' };

/** The History tab's names for a row's fields (spec §7.5), in form order. */
const LABELS = { title: 'Tiêu đề', blurb: 'Mô tả', link_url: 'Link', is_published: 'Hiện/ẩn' };

/*
 * Spec §7.2 content/experiences: the rows in their guest order (1–5 shown),
 * each row's form and History, the deleted ones to bring back, the order's
 * History, and the section's words (experiences.*). The picture beside the
 * rows is the section's own (the sections screen).
 */
export default async function ExperiencesPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory] = await Promise.all([
    listExperiencesAdmin(pool),
    listDeleted(pool, EXPERIENCE),
    listHistory(pool, 'experiences', null, 10),
  ]);
  const tabs = await formLocales(pool);
  const states = await listStates(pool, EXPERIENCE, tabs);
  const histories = await Promise.all(items.map((e) => listHistory(pool, 'experiences', e.id, 10)));
  const shown = items.filter((i) => i.isPublished).length;

  return (
    <LocaleTabs locales={tabs}>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Experiences</h1>
      <p className="a-lede">
        Các dòng của mục Experiences ở trang chủ, theo thứ tự khách thấy; mỗi dòng mở link của nó ở thẻ mới. Ảnh bên cạnh sửa ở{' '}
        <Link href="/admin/content/sections">Section trang chủ</Link>. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.
      </p>

      <section className="a-section-card" aria-labelledby="experiences-list-title">
        <h2 id="experiences-list-title">Các dòng</h2>
        <ItemList
          label="Thứ tự Experiences"
          noun="mục"
          items={items.map((e) => ({ id: e.id, name: e.name, isPublished: e.isPublished, token: e.token, meta: e.values.link ?? 'Không có link: trỏ về section' }))}
          listToken={token}
          limit={LIMITS.experiences.max}
          warnings={limitWarnings('experiences', shown)}
          empty="Chưa có mục nào."
          reorder={reorderExperiencesAction}
          toggle={toggleExperienceAction}
          remove={deleteExperienceAction}
          details={Object.fromEntries(
            items.map((e, i) => [
              e.id,
              <div key={e.id}>
                <LocaleTabs locales={tabs} states={states.get(e.id)}>
                  <ExperienceForm id={e.id} token={e.token} values={e.values} label={`Mục “${e.name}”`} />
                </LocaleTabs>
                <HistoryPanel
                  title={`Lịch sử: ${e.name}`}
                  headingId={`experience-${e.id}-history`}
                  entries={histories[i]}
                  currentToken={e.token}
                  recordId={e.id}
                  labels={LABELS}
                  restore={restoreExperienceAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm mục</h3>
        <ExperienceForm
          id={null}
          token={token}
          label="Thêm mục Experiences"
          values={{ link: null, isPublished: shown < LIMITS.experiences.max, title: { en: null }, blurb: { en: null } }}
        />
      </section>

      <DeletedList
        headingId="experiences-deleted"
        empty="Không có mục nào bị xóa."
        deleted={deleted}
        name={(before, id) => enOf(before, 'title') ?? `Trải nghiệm ${id}`}
        restore={restoreExperienceAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự Experiences"
        headingId="experiences-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="experiences"
        labels={{}}
        restore={restoreExperienceOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="experiences-copy">
        <h2 id="experiences-copy">Chữ của mục Experiences</h2>
        <StringsPanel searchParams={searchParams} screen="experiences" title="Chữ mục Experiences" />
      </section>
    </LocaleTabs>
  );
}
