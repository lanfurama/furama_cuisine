import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { limitWarnings } from '@/lib/admin/content-rules';
import { formLocales, listStates } from '@/lib/server/content-admin/form-locales';
import { CUISINE, listCuisinesAdmin } from '@/lib/server/content-admin/cuisines';
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
import { deleteCuisineAction, reorderCuisinesAction, restoreCuisineAction, restoreCuisineOrderAction, toggleCuisineAction } from './actions';
import { CuisineForm } from './CuisineForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ẩm thực' };

/** The History tab's names for a cuisine's fields (spec §7.5), in form order. */
const LABELS = { label: 'Tên ẩm thực', image_id: 'Ảnh', is_published: 'Hiện/ẩn' };

/*
 * Spec §7.2 content/cuisines: the rail in its guest order (ten at most is
 * advised), each cuisine's form and History, the deleted ones to bring back,
 * the order's History, and the section's words (cuisines.*).
 */
export default async function CuisinesPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory, images] = await Promise.all([
    listCuisinesAdmin(pool),
    listDeleted(pool, CUISINE),
    listHistory(pool, 'cuisines', null, 10),
    listMediaOptions(pool, 'image'),
  ]);
  const tabs = await formLocales(pool);
  const states = await listStates(pool, CUISINE, tabs);
  const histories = await Promise.all(items.map((c) => listHistory(pool, 'cuisines', c.id, 10)));
  const upload = { prefix: envPrefix(), configured: isBlobConfigured() };
  const shown = items.filter((i) => i.isPublished).length;
  const thumbOf = (id: string) => images.find((i) => i.id === id) ?? null;

  return (
    <LocaleTabs locales={tabs}>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Ẩm thực</h1>
      <p className="a-lede">
        Thanh “Explore by Cuisine” ở trang chủ, theo thứ tự khách thấy; cũng là bộ lọc ẩm thực và nhãn ẩm thực trên thẻ nhà hàng. Lưu là lên web ngay; mọi
        thay đổi khôi phục được từ Lịch sử.
      </p>

      <section className="a-section-card" aria-labelledby="cuisines-list-title">
        <h2 id="cuisines-list-title">Danh sách ẩm thực</h2>
        <ItemList
          label="Thứ tự ẩm thực"
          noun="ẩm thực"
          items={items.map((c) => ({
            id: c.id,
            name: c.name,
            isPublished: c.isPublished,
            token: c.token,
            meta: `${c.restaurants} nhà hàng`,
            thumb: thumbOf(c.values.imageId),
            hideWarning: c.shownRestaurants ? `Ẩm thực này biến khỏi thanh ẩm thực, bộ lọc và thẻ của ${c.shownRestaurants} nhà hàng.` : null,
          }))}
          listToken={token}
          warnings={limitWarnings('cuisines', shown)}
          empty="Chưa có ẩm thực nào."
          reorder={reorderCuisinesAction}
          toggle={toggleCuisineAction}
          remove={deleteCuisineAction}
          details={Object.fromEntries(
            items.map((c, i) => [
              c.id,
              <div key={c.id}>
                <LocaleTabs locales={tabs} states={states.get(c.id)}>
                  <CuisineForm id={c.id} token={c.token} values={c.values} images={images} upload={upload} label={`Ẩm thực “${c.name}”`} />
                </LocaleTabs>
                <HistoryPanel
                  title={`Lịch sử: ${c.name}`}
                  headingId={`cuisine-${c.id}-history`}
                  entries={histories[i]}
                  currentToken={c.token}
                  recordId={c.id}
                  labels={LABELS}
                  restore={restoreCuisineAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm ẩm thực</h3>
        <CuisineForm id={null} token={token} images={images} upload={upload} label="Thêm ẩm thực" values={{ id: '', imageId: '', isPublished: true, label: { en: null } }} />
      </section>

      <DeletedList
        headingId="cuisines-deleted"
        empty="Không có ẩm thực nào bị xóa."
        deleted={deleted}
        name={(before, id) => enOf(before, 'label') ?? id}
        restore={restoreCuisineAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự ẩm thực"
        headingId="cuisines-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="cuisines"
        labels={{}}
        restore={restoreCuisineOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="cuisines-copy">
        <h2 id="cuisines-copy">Chữ của mục Explore by Cuisine</h2>
        <StringsPanel screen="cuisines" title="Chữ mục ẩm thực" />
      </section>
    </LocaleTabs>
  );
}
