import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { EMAIL_EVENT_LABELS, maskEmail } from '@/lib/email/events';
import { roleCan } from '@/lib/server/auth/permissions';
import { requirePagePermission } from '@/lib/server/dal/session';
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES } from '@/lib/server/email/drain';
import { outboxEnv } from '@/lib/server/email/env';
import { deliveryModeNotice } from '@/lib/server/email/mode';
import { EMAIL_LOG_TABS, listEmailLog, resendable, type EmailLogTab } from '@/lib/server/email/outbox-log';
import { redactEmails } from '@/lib/server/email/types';
import { EmailStatusBadge } from '../_ui/EmailStatusBadge';
import { ResendEmail } from '../_ui/ResendEmail';
import { SectionNav } from '../_ui/SectionNav';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký email' };

const TAB_LABELS: Record<EmailLogTab, string> = { all: 'Tất cả', failed: 'Lỗi', queued: 'Đang chờ', sent: 'Đã gửi', skipped: 'Bỏ qua' };

type Search = { tab?: string | string[]; sau?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** The list shows the start of an error; the booking's page shows all of it. */
const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** 1 → "1 phút", 60 → "1 giờ": the retry ladder in words, from the drain's own constant. */
const wait = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} giờ` : `${minutes} phút`);

/*
 * Spec §7.2 "Nhật ký email, gửi lại": this deployment's booking emails, newest
 * first. A guest's address shows masked (l•••@gmail.com, R12): the list is for
 * spotting failures, and the full address is one click away on the booking,
 * which staff open anyway to act. Staff addresses show in full. The URL holds
 * only the tab and the cursor, never an address (phase-4 SEC-2).
 */
export default async function EmailLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const tab = (EMAIL_LOG_TABS as readonly string[]).includes(one(params.tab) ?? '') ? (one(params.tab) as EmailLogTab) : 'all';
  const after = one(params.sau);
  const { rows, next } = await listEmailLog(getPool(), { env: outboxEnv(), tab, after });
  const canResend = roleCan(staff.role, { reservations: ['update'] });
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), ...extra }).toString();
    return q ? `/admin/reservations/emails?${q}` : '/admin/reservations/emails';
  };

  return (
    <>
      <SectionNav current="/admin/reservations/emails" />
      <h1>Nhật ký email</h1>
      <p className="a-lede">
        {`Email lỗi được gửi lại tự động tối đa ${MAX_ATTEMPTS} lần (sau ${RETRY_DELAYS_MINUTES.map(wait).join(', ')}); hết lượt thì báo “Lỗi” ở đây và trên Tổng quan.`}
      </p>
      <p className="a-muted" data-testid="delivery-mode">
        {deliveryModeNotice()}
      </p>
      <nav className="a-tabs" aria-label="Lọc email">
        {EMAIL_LOG_TABS.map((t) => (
          <Link key={t} href={t === 'all' ? '/admin/reservations/emails' : `/admin/reservations/emails?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="a-lede">Không có email nào.</p>
      ) : (
        <div className="a-table-scroll">
          <table className="a-table">
            <thead>
              <tr>
                <th scope="col">Email · tạo lúc</th>
                <th scope="col">Người nhận</th>
                <th scope="col">Đặt bàn</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Lỗi gần nhất</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {EMAIL_EVENT_LABELS[r.event]}
                    <small className="a-sub">{formatDateTimeVi(r.createdAt)}</small>
                  </td>
                  <td>
                    {r.audience === 'guest' ? maskEmail(r.toEmail) : r.toEmail}
                    <small className="a-sub">{r.locale}</small>
                  </td>
                  <td className="a-ref">
                    <Link href={`/admin/reservations/${r.reservationId}`}>{r.reference}</Link>
                    <small className="a-sub">{r.restaurantName}</small>
                  </td>
                  <td>
                    <EmailStatusBadge status={r.status} />
                    {r.status === 'sent' && r.sentAt ? <small className="a-sub">{formatDateTimeVi(r.sentAt)}</small> : null}
                    {r.status === 'queued' && r.attempts > 0 ? <small className="a-sub">{`Lần tới: ${formatDateTimeVi(r.nextAttemptAt)}`}</small> : null}
                    <small className="a-sub">{`${r.attempts} lần gửi`}</small>
                  </td>
                  <td>{r.lastError ? <span className="a-error-text">{clip(redactEmails(r.lastError))}</span> : '—'}</td>
                  <td>{canResend && resendable(r.status) ? <ResendEmail id={r.id} label={`${EMAIL_EVENT_LABELS[r.event]} ${r.reference}`} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next || after ? (
        <nav className="a-pager" aria-label="Phân trang">
          {after ? <Link href={href({})}>← Trang đầu</Link> : null}
          {next ? <Link href={href({ sau: next })}>Trang sau →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
