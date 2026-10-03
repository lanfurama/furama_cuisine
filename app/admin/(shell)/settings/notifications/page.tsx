import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { listDestinationOptions, listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { deliveryModeNotice } from '@/lib/server/email/mode';
import { getSharedInbox, listRecipients, restaurantsWithoutRecipient } from '@/lib/server/email/recipients';
import { DeleteRecipient, RecipientEditor, type RecipientOptions, type RecipientValues } from './RecipientForm';
import { SharedInboxForm } from './SharedInboxForm';
import { TestEmailForm } from './TestEmailForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Thông báo email' };

const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đến', restaurant: 'Nhà hàng' } as const;

/*
 * Spec §7.2 /admin/settings/notifications (Admin only, §7.1): who receives
 * "đặt bàn mới" (notification_recipients), the shared inbox that receives it
 * when nobody does (site_settings.email), the restaurants in that case (R21),
 * and "Gửi email thử" (R9).
 */
export default async function NotificationsPage() {
  // Before any query: an Editor gets the 403 view.
  const staff = await requirePagePermission({ settings: ['read'] });
  const pool = getPool();
  const [recipients, inbox, uncovered, restaurants, destinations, locales] = await Promise.all([
    listRecipients(pool),
    getSharedInbox(pool),
    restaurantsWithoutRecipient(pool),
    listRestaurantOptions(pool),
    listDestinationOptions(pool),
    listLocales(pool),
  ]);
  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
  const options: RecipientOptions = {
    restaurants,
    destinations,
    locales: locales.map((l) => ({ code: l.code, name: l.name })),
  };

  return (
    <>
      <h1>Thông báo email</h1>
      <p className="a-lede">Ai nhận email khi khách đặt bàn online, và thử gửi email từ môi trường này.</p>
      <p className="a-muted" data-testid="delivery-mode">
        {deliveryModeNotice()}
      </p>

      <section aria-labelledby="notify-recipients-title">
        <h2 id="notify-recipients-title">Người nhận “đặt bàn mới”</h2>
        <p className="a-muted">
          Mỗi đặt bàn online gửi tới mọi người nhận khớp với nhà hàng đó (tất cả nhà hàng, điểm đến của nhà hàng, hoặc chính nhà hàng),
          mỗi địa chỉ một email.
        </p>
        {recipients.length === 0 ? <p className="a-lede">Chưa có người nhận nào.</p> : null}
        {recipients.map((r) => {
          const where =
            r.scope === 'all'
              ? SCOPE_LABELS.all
              : r.scope === 'destination'
                ? `${SCOPE_LABELS.destination}: ${destinationName.get(r.destinationId ?? '') ?? r.destinationId}`
                : `${SCOPE_LABELS.restaurant}: ${r.restaurantName ?? r.restaurantId}`;
          const values: RecipientValues = {
            id: r.id,
            token: r.token,
            scope: r.scope,
            destinationId: r.destinationId,
            restaurantId: r.restaurantId,
            email: r.email,
            events: r.events,
            locale: r.locale,
            active: r.active,
          };
          return (
            <section className="a-card-row" key={r.id} aria-label={`${r.email} · ${where}`}>
              <h3>
                {r.email}
                {r.active ? null : <span className="a-tag">Đang tắt</span>}
              </h3>
              <p>{`${where} · ${r.locale}`}</p>
              <details>
                <summary>Sửa</summary>
                <RecipientEditor options={options} values={values} />
              </details>
              <DeleteRecipient values={values} />
            </section>
          );
        })}
        <h3>Thêm người nhận</h3>
        <RecipientEditor options={options} values={null} />
      </section>

      <section aria-labelledby="notify-inbox-title">
        <h2 id="notify-inbox-title">Hộp thư chung</h2>
        <p className="a-muted">
          Nhận email “đặt bàn mới” của những nhà hàng chưa có người nhận, và là địa chỉ khách trả lời khi họ bấm Reply. Đây cũng là email
          chung hiện ở chân trang web và trong trang chính sách bảo mật; lưu xong, web khách đổi theo ngay.
        </p>
        <SharedInboxForm email={inbox.email} token={inbox.token} />
      </section>

      <section aria-labelledby="notify-uncovered-title">
        <h2 id="notify-uncovered-title">Nhà hàng chưa có người nhận</h2>
        {uncovered.length === 0 ? (
          <p className="a-muted">Nhà hàng nào nhận đặt bàn online cũng có người nhận thông báo.</p>
        ) : (
          <>
            <p className="a-warn" role="note">{`Email “đặt bàn mới” của các nhà hàng này đang về hộp thư chung (${inbox.email}).`}</p>
            <ul className="a-list" aria-label="Nhà hàng chưa có người nhận">
              {uncovered.map((r) => (
                <li className="a-list-item" key={r.id}>
                  {r.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="notify-test-title">
        <h2 id="notify-test-title">Gửi email thử</h2>
        <p className="a-muted">Gửi một mẫu email với đặt bàn giả (không dùng dữ liệu khách), qua đúng đường gửi của email thật.</p>
        <TestEmailForm defaultTo={staff.email} locales={options.locales} />
      </section>
    </>
  );
}
