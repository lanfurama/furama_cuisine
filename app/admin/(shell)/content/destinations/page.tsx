import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { formLocales, listStates } from '@/lib/server/content-admin/form-locales';
import { DESTINATION, listDestinationsAdmin, type DestinationListItem } from '@/lib/server/content-admin/destinations';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { DeletedList, enOf } from '../../_kit/DeletedList';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { ItemList } from '../../_kit/ItemList';
import { LocaleTabs } from '../../_kit/LocaleTabs';
import { StringsPanel } from '../_ui/StringsPanel';
import {
  deleteDestinationAction,
  reorderDestinationsAction,
  restoreDestinationAction,
  restoreDestinationOrderAction,
  toggleDestinationAction,
} from './actions';
import { DestinationForm } from './DestinationForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Điểm đến' };

/** The History tab's names for a destination's fields (spec §7.5), in form order. */
const LABELS = {
  kind: 'Loại thẻ',
  name: 'Tên địa điểm',
  card_title_1: 'Tiêu đề thẻ, dòng 1',
  card_title_2: 'Tiêu đề thẻ, dòng 2',
  card_blurb_1: 'Mô tả thẻ, dòng 1',
  card_blurb_2: 'Mô tả thẻ, dòng 2',
  card_image_id: 'Ảnh thẻ',
  address: 'Địa chỉ',
  phone_display: 'Số điện thoại',
  phone_e164: 'Số điện thoại (quay số)',
  map_url: 'Link bản đồ',
  email: 'Email',
  show_in_footer: 'Hiện ở chân trang',
  is_published: 'Hiện/ẩn',
};

/** What hiding one destination takes off the site (phase-6 ledger D1, L7-2): its restaurants, their pages, offers and online booking. */
function hideWarning(d: DestinationListItem): string | null {
  if (d.kind === 'teaser' || d.shownRestaurants === 0) return null;
  return `${d.shownRestaurants} nhà hàng đang hiện của điểm đến này sẽ biến khỏi web (thẻ, trang, ưu đãi) và không nhận đặt bàn online cho tới khi hiện lại.`;
}

/*
 * Spec §7.2 content/destinations: the cards in their guest order (2–5 shown,
 * at most one teaser), each card's form and History, the deleted ones to
 * bring back, the order's History, and the section's words (destinations.*).
 */
export default async function DestinationsPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory, images] = await Promise.all([
    listDestinationsAdmin(pool),
    listDeleted(pool, DESTINATION),
    listHistory(pool, 'destinations', null, 10),
    listMediaOptions(pool, 'image'),
  ]);
  const tabs = await formLocales(pool);
  const states = await listStates(pool, DESTINATION, tabs);
  const histories = await Promise.all(items.map((d) => listHistory(pool, 'destinations', d.id, 10)));
  const upload = { prefix: envPrefix(), configured: isBlobConfigured() };
  const shown = items.filter((i) => i.isPublished).length;
  const thumbOf = (id: string | null) => images.find((i) => i.id === id) ?? null;

  return (
    <LocaleTabs locales={tabs}>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Điểm đến</h1>
      <p className="a-lede">
        Thẻ của mục Our Destinations, theo thứ tự khách thấy, và các địa điểm mà bộ lọc, chân trang và trang nhà hàng nêu tên. Ẩn một điểm đến là ẩn mọi
        nhà hàng của nó. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.
      </p>

      <section className="a-section-card" aria-labelledby="destinations-list-title">
        <h2 id="destinations-list-title">Danh sách điểm đến</h2>
        <ItemList
          label="Thứ tự điểm đến"
          noun="điểm đến"
          items={items.map((d) => ({
            id: d.id,
            name: d.name,
            isPublished: d.isPublished,
            token: d.token,
            meta: d.kind === 'teaser' ? 'Teaser' : `Địa điểm · ${d.shownRestaurants} nhà hàng đang hiện`,
            thumb: thumbOf(d.values.cardImageId),
            hideWarning: hideWarning(d),
          }))}
          listToken={token}
          limit={LIMITS.destinations.max}
          warnings={limitWarnings('destinations', shown)}
          empty="Chưa có điểm đến nào."
          reorder={reorderDestinationsAction}
          toggle={toggleDestinationAction}
          remove={deleteDestinationAction}
          details={Object.fromEntries(
            items.map((d, i) => [
              d.id,
              <div key={d.id}>
                <LocaleTabs locales={tabs} states={states.get(d.id)}>
                  <DestinationForm id={d.id} token={d.token} values={d.values} images={images} upload={upload} hideNote={hideWarning(d)} label={`Điểm đến “${d.name}”`} />
                </LocaleTabs>
                <HistoryPanel
                  title={`Lịch sử: ${d.name}`}
                  headingId={`destination-${d.id}-history`}
                  entries={histories[i]}
                  currentToken={d.token}
                  recordId={d.id}
                  labels={LABELS}
                  restore={restoreDestinationAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm điểm đến</h3>
        <DestinationForm
          id={null}
          token={token}
          images={images}
          upload={upload}
          hideNote={null}
          label="Thêm điểm đến"
          values={{
            id: '',
            kind: 'venue',
            isPublished: false,
            showInFooter: false,
            cardImageId: null,
            phoneDisplay: null,
            phoneE164: null,
            email: null,
            mapUrl: null,
            name: { en: null },
            cardTitle1: { en: null },
            cardTitle2: { en: null },
            cardBlurb1: { en: null },
            cardBlurb2: { en: null },
            address: { en: null },
          }}
        />
      </section>

      <DeletedList
        headingId="destinations-deleted"
        empty="Không có điểm đến nào bị xóa."
        deleted={deleted}
        name={(before, id) => enOf(before, 'name') ?? enOf(before, 'card_title_1') ?? id}
        restore={restoreDestinationAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự điểm đến"
        headingId="destinations-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="destinations"
        labels={{}}
        restore={restoreDestinationOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="destinations-copy">
        <h2 id="destinations-copy">Chữ của mục Our Destinations</h2>
        <StringsPanel screen="destinations" title="Chữ mục Our Destinations" />
      </section>
    </LocaleTabs>
  );
}
