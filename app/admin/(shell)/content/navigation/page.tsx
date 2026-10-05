import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings, NAV_TARGETS } from '@/lib/admin/content-rules';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { listNavAdmin, NAV_ITEM } from '@/lib/server/content-admin/nav';
import { SECTION_LABELS } from '@/lib/server/content-admin/sections';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { DeletedList, enOf } from '../../_kit/DeletedList';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { ItemList } from '../../_kit/ItemList';
import { deleteNavItemAction, reorderNavItemsAction, restoreNavItemAction, restoreNavItemOrderAction, toggleNavItemAction } from './actions';
import { NavItemForm } from './NavItemForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Menu điều hướng' };

/** The History tab's names for an item's fields (spec §7.5), in form order. */
const LABELS = { label: 'Nhãn', target_section: 'Trỏ tới section', is_published: 'Hiện/ẩn' };

/*
 * Spec §7.2 content/navigation: the menu in its order (at most 6 shown; an
 * item whose section is off stays out), each item's form and History, the
 * deleted ones to bring back, and the order's History. The header's and the
 * menu's own words (SEARCH, RESERVE, …) are ui.* keys, on "Chữ giao diện".
 */
export default async function NavigationPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory] = await Promise.all([listNavAdmin(pool), listDeleted(pool, NAV_ITEM), listHistory(pool, 'nav_items', null, 10)]);
  const histories = await Promise.all(items.map((n) => listHistory(pool, 'nav_items', n.id, 10)));
  const shown = items.filter((i) => i.isPublished).length;
  // A section takes one item (nav_items_target_section_key): each form offers the free ones and its own.
  const taken = new Set(items.map((i) => i.values.targetSection));
  const targetsFor = (own: string | null) => NAV_TARGETS.filter((t) => t === own || !taken.has(t)).map((key) => ({ key, label: SECTION_LABELS[key] }));
  const free = targetsFor(null);

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Menu điều hướng</h1>
      <p className="a-lede">
        Các mục của thanh menu trên đầu trang và của menu điện thoại, theo thứ tự khách thấy; mỗi mục cuộn tới một section của trang chủ. Chữ của các nút
        (SEARCH, RESERVE …) sửa ở <Link href="/admin/content/ui-text">Chữ giao diện</Link>. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.
      </p>

      <section className="a-section-card" aria-labelledby="nav-list-title">
        <h2 id="nav-list-title">Các mục</h2>
        <ItemList
          label="Thứ tự menu"
          noun="mục menu"
          items={items.map((n) => ({
            id: n.id,
            name: n.name,
            isPublished: n.isPublished,
            token: n.token,
            meta: `Section ${SECTION_LABELS[n.values.targetSection]}${n.sectionVisible ? '' : ' · section đang tắt: mục không hiện'}`,
          }))}
          listToken={token}
          limit={LIMITS.navItems.max}
          warnings={limitWarnings('navItems', shown)}
          empty="Menu chưa có mục nào."
          reorder={reorderNavItemsAction}
          toggle={toggleNavItemAction}
          remove={deleteNavItemAction}
          details={Object.fromEntries(
            items.map((n, i) => [
              n.id,
              <div key={n.id}>
                <NavItemForm id={n.id} token={n.token} values={n.values} targets={targetsFor(n.values.targetSection)} label={`Mục menu “${n.name}”`} />
                <HistoryPanel
                  title={`Lịch sử: ${n.name}`}
                  headingId={`nav-${n.id}-history`}
                  entries={histories[i]}
                  currentToken={n.token}
                  recordId={n.id}
                  labels={LABELS}
                  restore={restoreNavItemAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm mục menu</h3>
        {free.length ? (
          <NavItemForm
            id={null}
            token={token}
            targets={free}
            label="Thêm mục menu"
            values={{ id: null, targetSection: free[0].key, isPublished: shown < LIMITS.navItems.max, label: { en: null } }}
          />
        ) : (
          <p className="a-muted">Mỗi section đã có một mục menu.</p>
        )}
      </section>

      <DeletedList
        headingId="nav-deleted"
        empty="Không có mục menu nào bị xóa."
        deleted={deleted}
        name={(before, id) => enOf(before, 'label') ?? `Mục ${id}`}
        restore={restoreNavItemAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự menu"
        headingId="nav-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="nav_items"
        labels={{}}
        restore={restoreNavItemOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />
    </>
  );
}
