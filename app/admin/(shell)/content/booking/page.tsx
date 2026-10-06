import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { bookableSql } from '@/lib/server/booking/rules';
import { listHistory } from '@/lib/server/content-admin/history';
import { BOOKING_DEFAULTS, getSettingsEditor, OCCASIONS } from '@/lib/server/content-admin/settings';
import { requirePagePermission } from '@/lib/server/dal/session';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';
import { restoreBookingDefaultsAction } from './actions';
import { BookingDefaultsForm } from './BookingDefaultsForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đặt bàn' };

/** The meals' admin names (the guest's are the meal.* keys below). */
const OCCASION_LABELS: Record<(typeof OCCASIONS)[number], string> = { Breakfast: 'Bữa sáng', Lunch: 'Bữa trưa', Dinner: 'Bữa tối', Drinks: 'Đồ uống' };

/*
 * Spec §7.2 content/booking: what the booking bar, the finder and the
 * reservation form start on (site_settings, with History), and their words
 * (booking.*, finder.*, meal.*). The form's field captions and the shared
 * words (form.*, common.*) are on "Chữ giao diện"; the booking rules
 * themselves (periods, window, party size) on each restaurant's booking
 * screen.
 */
export default async function BookingContentPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [editor, history, restaurants] = await Promise.all([
    getSettingsEditor(pool, BOOKING_DEFAULTS),
    listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10),
    pool.query<{ id: string; name: string; bookable: boolean }>(
      `SELECT r.id, r.name, ${bookableSql('r')} AS bookable FROM restaurants r WHERE r.archived_at IS NULL ORDER BY r.sort_order, r.id`,
    ),
  ]);
  const lastSaved = history[0] ? { by: history[0].actor, at: formatDateTimeVi(history[0].at) } : null;

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Đặt bàn</h1>
      <p className="a-lede">
        Thanh đặt bàn, ô tìm nhà hàng và form đặt bàn của web khách: lựa chọn sẵn và chữ. Nhãn các ô nhập và chữ dùng chung sửa ở{' '}
        <Link href="/admin/content/ui-text">Chữ giao diện</Link>. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.
      </p>

      <section className="a-section-card" aria-labelledby="booking-defaults">
        <h2 id="booking-defaults">Lựa chọn sẵn</h2>
        <BookingDefaultsForm
          token={editor.token}
          values={{ restaurant: (editor.values.default_restaurant_id as string | null) ?? null, occasion: (editor.values.default_occasion as string | null) ?? null }}
          restaurants={restaurants.rows}
          occasions={OCCASIONS.map((key) => ({ key, label: OCCASION_LABELS[key] }))}
          lastSaved={lastSaved}
        />
        <HistoryPanel
          title="Lịch sử: lựa chọn sẵn"
          headingId="booking-defaults-history"
          entries={history}
          currentToken={editor.token}
          recordId={BOOKING_DEFAULTS.id}
          labels={{ default_restaurant_id: 'Nhà hàng chọn sẵn', default_occasion: 'Dịp chọn sẵn' }}
          restore={restoreBookingDefaultsAction}
        />
      </section>

      <section aria-labelledby="booking-copy">
        <h2 id="booking-copy">Chữ của đặt bàn</h2>
        <StringsPanel searchParams={searchParams}
          screen="booking"
          title="Chữ đặt bàn"
          groups={[
            { title: 'Ô tìm nhà hàng (dưới hero)', prefix: 'finder.' },
            { title: 'Tên các bữa', prefix: 'meal.' },
            { title: 'Nhãn của thanh và form đặt bàn', prefix: 'booking.label_' },
            { title: 'Các phần của form đặt bàn', prefix: 'booking.section_' },
            { title: 'Giờ', prefix: 'booking.slot_' },
            { title: 'Ngày không đặt được', prefix: 'booking.day_' },
            { title: 'Màn cảm ơn', prefix: 'booking.done' },
          ]}
        />
      </section>
    </>
  );
}
