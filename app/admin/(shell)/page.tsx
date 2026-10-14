import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatShortDayVi, todayVi } from '@/lib/admin/format';
import { HOLDING_STATUSES } from '@/lib/booking/rules';
import { roleCan } from '@/lib/server/auth/permissions';
import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
import { coverageSummary } from '@/lib/server/content-admin/translations';
import { listInbox, overviewCounts, type InboxRow } from '@/lib/server/booking/queries';
import { verifySession } from '@/lib/server/dal/session';
import { outboxEnv } from '@/lib/server/email/env';
import { emailOverview } from '@/lib/server/email/outbox-log';
import { venueNow } from '@/lib/venue-time';
import { Icon, type IconName } from '../_ui/Icon';
import { PageHeader } from '../_ui/PageHeader';
import { QuickConfirm } from './reservations/QuickConfirm';
import { StatusBadge } from './reservations/_ui/StatusBadge';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

/** How many bookings each of the overview's two short lists shows; the inbox has the rest. */
const SHORT_LIST = 6;

type Tone = 'warn' | 'danger' | 'ok' | 'info' | null;

/* One count as a card that opens its list; the words stay inside the link, so "7 chờ xác nhận" is its name. */
function Kpi({ href, testId, icon, value, label, tone }: { href: string; testId: string; icon: IconName; value: number; label: string; tone: Tone }) {
  return (
    <li>
      <Link className={tone ? `a-kpi a-kpi--${tone}` : 'a-kpi'} href={href} data-testid={testId}>
        <span className="a-kpi-icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
        <strong className="a-kpi-value">{value}</strong>
        <span className="a-kpi-label">{` ${label}`}</span>
        <Icon name="arrow-right" size={16} className="a-kpi-arrow" />
      </Link>
    </li>
  );
}

/* A booking in one line: its sitting, guest and restaurant, then its status or "Xác nhận". */
function BookingLine({ row, showDay, canConfirm }: { row: InboxRow; showDay: boolean; canConfirm: boolean }) {
  return (
    <li>
      <span className="a-mini-when">
        {row.time}
        {showDay ? <small>{formatShortDayVi(row.date)}</small> : null}
      </span>
      <span className="a-mini-who">
        <Link href={`/admin/reservations/${row.id}`}>{row.name}</Link>
        <small>{`${row.guests} khách · ${row.restaurantName} · ${row.reference}`}</small>
      </span>
      {canConfirm && row.status === 'requested' ? (
        <QuickConfirm id={row.id} version={row.version} reference={row.reference} />
      ) : (
        <StatusBadge status={row.status} />
      )}
    </li>
  );
}

/*
 * The greeting; bookings waiting for staff and today's bookings (spec §7.2
 * "đặt bàn chờ xử lý"), with the booking emails of this environment that used
 * up their attempts ("email lỗi", §10.4, §12) and those retrying after a
 * failure (an SMTP outage shows within minutes), both only for sittings still
 * ahead, for roles that read bookings; the next requests to confirm (soonest
 * sitting first, "Xác nhận" beside each) and today's sittings;
 * to Admins, invitations whose email failed, and the restaurants whose "đặt
 * bàn mới" goes to the shared inbox ("nhà hàng chưa có người nhận thông báo",
 * R21); to roles that read content, each language's share of reviewed
 * translations and how many are "EN đã đổi" (spec §7.2 "bản dịch thiếu hoặc
 * lỗi thời"), shown once there is a language besides the default one.
 */
export default async function OverviewPage() {
  const staff = await verifySession();
  const pool = getPool();
  const failed = roleCan(staff.role, { user: ['list'] }) ? (await listOpenInvitations(pool)).filter((i) => i.email_error !== null) : [];
  // Today is Da Nang's date, whatever the server's timezone.
  const today = venueNow().date;
  const readsBookings = roleCan(staff.role, { reservations: ['read'] });
  const [bookings, emails, pending, todays] = readsBookings
    ? await Promise.all([
        overviewCounts(pool, today),
        emailOverview(pool, outboxEnv()),
        listInbox(pool, { tab: 'pending', today }),
        listInbox(pool, { tab: 'today', today }),
      ])
    : [null, null, null, null];
  const unrouted = emails && roleCan(staff.role, { settings: ['read'] }) ? emails.unrouted : [];
  const translations = roleCan(staff.role, { content: ['read'] }) ? await coverageSummary(pool) : [];
  const canConfirm = roleCan(staff.role, { reservations: ['update'] });
  const nextPending = pending?.rows.slice(0, SHORT_LIST) ?? [];
  const todayHeld = (todays?.rows ?? []).filter((r) => (HOLDING_STATUSES as readonly string[]).includes(r.status));

  return (
    <>
      <PageHeader
        title="Tổng quan"
        lede={
          <>
            Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
          </>
        }
      />

      {failed.length > 0 ? (
        <section aria-labelledby="failed-invitations" className="a-warn">
          <h2 id="failed-invitations">Lời mời chưa gửi được email</h2>
          <ul>
            {failed.map((i) => (
              <li key={i.id}>{i.email}</li>
            ))}
          </ul>
          <p>
            <Link href="/admin/users">Mở trang Nhân viên để gửi lại</Link>
          </p>
        </section>
      ) : null}

      {unrouted.length > 0 ? (
        <section aria-labelledby="overview-unrouted" className="a-warn">
          <h2 id="overview-unrouted">Nhà hàng chưa có người nhận thông báo</h2>
          <p data-testid="uncovered-restaurants">
            {`${unrouted.length} nhà hàng: ${unrouted.map((r) => r.name).join(', ')}. Email đặt bàn mới của các nhà hàng này đang về hộp thư chung.`}
          </p>
          <p>
            <Link href="/admin/settings/notifications">Mở Thông báo email để thêm người nhận</Link>
          </p>
        </section>
      ) : null}

      {bookings ? (
        <section aria-labelledby="overview-bookings">
          <h2 id="overview-bookings" className="a-visually-hidden">
            Đặt bàn
          </h2>
          <ul className="a-kpis">
            <Kpi
              href="/admin/reservations"
              testId="pending-count"
              icon="inbox"
              value={bookings.pending}
              label="chờ xác nhận"
              tone={bookings.pending > 0 ? 'warn' : 'ok'}
            />
            <Kpi
              href="/admin/reservations?tab=today"
              testId="today-count"
              icon="calendar-check"
              value={bookings.today}
              label={`đặt bàn hôm nay · ${bookings.todayCovers} khách`}
              tone="info"
            />
            <Kpi
              href="/admin/reservations/emails?tab=failed"
              testId="failed-emails"
              icon="mail"
              value={emails?.failed ?? 0}
              label="email lỗi"
              tone={emails?.failed ? 'danger' : null}
            />
            <Kpi
              href="/admin/reservations/emails?tab=queued"
              testId="retrying-emails"
              icon="clock"
              value={emails?.retrying ?? 0}
              label="email đang thử lại"
              tone={emails?.retrying ? 'warn' : null}
            />
          </ul>
        </section>
      ) : null}

      {bookings ? (
        <div className="a-dash-grid">
          <section aria-labelledby="overview-pending" className="a-card-row">
            <div className="a-panel-head">
              <h2 id="overview-pending">Cần xác nhận</h2>
              <Link href="/admin/reservations">
                Hộp thư
                <Icon name="chevron-right" size={16} />
              </Link>
            </div>
            {nextPending.length === 0 ? (
              <p className="a-empty">
                <Icon name="check" size={24} />
                Không có đặt bàn nào chờ xác nhận.
              </p>
            ) : (
              <ul className="a-mini-list" aria-label="Đặt bàn chờ xác nhận gần nhất">
                {nextPending.map((r) => (
                  <BookingLine key={r.id} row={r} showDay canConfirm={canConfirm} />
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="overview-today" className="a-card-row">
            <div className="a-panel-head">
              <h2 id="overview-today">Hôm nay</h2>
              <Link href="/admin/reservations/day">
                Bảng theo ngày
                <Icon name="chevron-right" size={16} />
              </Link>
            </div>
            {todayHeld.length === 0 ? (
              <p className="a-empty">
                <Icon name="calendar" size={24} />
                Chưa có đặt bàn nào hôm nay.
              </p>
            ) : (
              <ul className="a-mini-list" aria-label="Đặt bàn hôm nay">
                {todayHeld.slice(0, SHORT_LIST).map((r) => (
                  <BookingLine key={r.id} row={r} showDay={false} canConfirm={canConfirm} />
                ))}
              </ul>
            )}
            {todayHeld.length > SHORT_LIST ? (
              <p className="a-muted">
                <Link href="/admin/reservations?tab=today">{`Và ${todayHeld.length - SHORT_LIST} đặt bàn khác`}</Link>
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {translations.length > 0 ? (
        <section aria-labelledby="overview-translations" className="a-card-row">
          <div className="a-panel-head">
            <h2 id="overview-translations">Bản dịch</h2>
            <Link href="/admin/translations#queue">
              Xem hàng chờ
              <Icon name="chevron-right" size={16} />
            </Link>
          </div>
          <ul className="a-progress-list" data-testid="translation-coverage">
            {translations.map((t) => (
              <li key={t.code} className="a-progress-row">
                <div>
                  <Link href={`/admin/translations?locale=${t.code}#queue`}>
                    <strong>{t.percent}%</strong> {t.name} đã duyệt
                  </Link>
                  {t.stale ? <span className="a-tag a-tag--warn">{`${t.stale} EN đã đổi`}</span> : null}
                </div>
                <progress value={t.percent} max={100} aria-label={`${t.name}: ${t.percent}% đã duyệt`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
