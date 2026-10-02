import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
import { seatings } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES } from '@/lib/booking/rules';
import { fromMinutes } from '@/lib/venue-time';
import { EMAIL_EVENT_LABELS } from '@/lib/email/events';
import { SOURCE_LABELS, STATUS_LABELS, availableTransitions, opensAtMinutes } from '@/lib/reservations/lifecycle';
import { roleCan } from '@/lib/server/auth/permissions';
import { getReservation, listEvents, listNotes } from '@/lib/server/booking/queries';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { outboxEnv } from '@/lib/server/email/env';
import { listReservationEmails, resendable } from '@/lib/server/email/outbox-log';
import { redactEmails } from '@/lib/server/email/types';
import { EmailStatusBadge } from '../_ui/EmailStatusBadge';
import { ResendEmail } from '../_ui/ResendEmail';
import { SectionNav } from '../_ui/SectionNav';
import { StatusBadge } from '../_ui/StatusBadge';
import { EditReservationForm } from './EditReservationForm';
import { NoteForm } from './NoteForm';
import { TransitionPanel, type TransitionOption } from './TransitionPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chi tiết đặt bàn' };

const EVENT_LABELS: Record<string, string> = {
  created: 'Tạo đặt bàn',
  status_changed: 'Đổi trạng thái',
  edited: 'Sửa đặt bàn',
  note_added: 'Thêm ghi chú nội bộ',
};

const FIELD_LABELS: Record<string, string> = {
  date: 'Ngày',
  time: 'Giờ',
  guests: 'Số khách',
  name: 'Tên',
  phone: 'Điện thoại',
  email: 'Email',
  note: 'Yêu cầu của khách',
  over_capacity: 'Vượt sức chứa',
};

/** "Giờ: 19:00 → 19:30 · Số khách: 2 → 4" from an edited event's changes. */
function describeChanges(changes: Record<string, unknown> | null): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes)
    .filter(([key, value]) => key in FIELD_LABELS && Array.isArray(value))
    .map(([key, value]) => {
      const [before, after] = value as unknown[];
      const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v === true ? 'có' : v === false ? 'không' : String(v));
      return `${FIELD_LABELS[key]}: ${show(before)} → ${show(after)}`;
    });
  return parts.length ? parts.join(' · ') : null;
}

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePagePermission({ reservations: ['read'] });
  const { id } = await params;
  const pool = getPool();
  const reservation = await getReservation(pool, id);
  if (!reservation) notFound();
  const [events, notes, loaded, emails] = await Promise.all([
    listEvents(pool, id),
    listNotes(pool, [id]),
    loadRestaurantRules(pool, reservation.restaurantId, 'vi', reservation.date),
    listReservationEmails(pool, id, outboxEnv()),
  ]);
  const canResend = roleCan(staff.role, { reservations: ['update'] });

  // The page renders at request time (after the session read), so the windows are this request's.
  const options: TransitionOption[] = availableTransitions(reservation.status, reservation.date, reservation.time).map(({ transition: t, window }) => {
    const opens = opensAtMinutes(t, reservation.time);
    let hint: string | null = null;
    if (!window.ok) {
      hint =
        window.code === 'too_late'
          ? 'Chỉ sửa được trong ngày phục vụ.'
          : opens !== null
            ? `Từ ${fromMinutes(opens)} ngày ${formatIsoDayVi(reservation.date)}.`
            : 'Chỉ trong ngày phục vụ.';
    }
    return { to: t.to, label: t.label, reasonRequired: t.reason === 'required', enabled: window.ok, hint };
  });
  // Every slot time of the restaurant's services; the booking's own time stays even if the hours moved.
  const times = [...new Set([...(loaded?.rules.periods ?? []).flatMap((p) => seatings(p)), reservation.time])].sort();
  const editable = (HOLDING_STATUSES as readonly string[]).includes(reservation.status);
  const ownNotes = notes.get(reservation.id) ?? [];

  return (
    <>
      <SectionNav current="/admin/reservations" />
      <p className="a-crumbs">
        <Link href="/admin/reservations">← Hộp thư</Link>
      </p>
      <h1>
        {`Đặt bàn ${reservation.reference} `}
        <StatusBadge status={reservation.status} />
      </h1>
      <dl className="a-facts">
        <dt>Nhà hàng</dt>
        <dd>{reservation.restaurantName}</dd>
        <dt>Ngày giờ</dt>
        <dd data-testid="sitting">{`${formatIsoDayVi(reservation.date)} ${reservation.time} · ${reservation.meal}`}</dd>
        <dt>Số khách</dt>
        <dd>
          {reservation.guests}
          {reservation.overCapacity ? <span className="a-tag a-tag--warn">Vượt sức chứa</span> : null}
        </dd>
        <dt>Khách</dt>
        <dd>
          {reservation.name} · <a href={`tel:${reservation.phone.replace(/[^\d+]/g, '')}`}>{reservation.phone}</a>
          {reservation.email ? ` · ${reservation.email}` : null}
        </dd>
        <dt>Yêu cầu của khách</dt>
        <dd>{reservation.note ?? '—'}</dd>
        <dt>Nguồn · ngôn ngữ</dt>
        <dd>{`${SOURCE_LABELS[reservation.source] ?? reservation.source} · ${reservation.locale}`}</dd>
        <dt>Tạo lúc</dt>
        <dd>{formatDateTimeVi(reservation.createdAt)}</dd>
        {reservation.statusReason ? (
          <>
            <dt>Lý do</dt>
            <dd>{reservation.statusReason}</dd>
          </>
        ) : null}
      </dl>

      <section aria-labelledby="res-status-title">
        <h2 id="res-status-title">Trạng thái</h2>
        <TransitionPanel id={reservation.id} version={reservation.version} options={options} hasEmail={Boolean(reservation.email)} />
      </section>

      {editable ? (
        <section aria-labelledby="res-edit-title">
          <h2 id="res-edit-title">Sửa đặt bàn</h2>
          <EditReservationForm
            reservation={{
              id: reservation.id,
              version: reservation.version,
              date: reservation.date,
              time: reservation.time,
              guests: reservation.guests,
              name: reservation.name,
              phone: reservation.phone,
              email: reservation.email ?? '',
              note: reservation.note ?? '',
            }}
            times={times}
          />
        </section>
      ) : null}

      <section aria-labelledby="res-notes-title">
        <h2 id="res-notes-title">Ghi chú nội bộ</h2>
        <p className="a-muted">Chỉ nhân viên thấy; không bao giờ gửi cho khách.</p>
        {ownNotes.length ? (
          <ul className="a-list" aria-label="Ghi chú nội bộ">
            {ownNotes.map((n) => (
              <li className="a-list-item a-list-item--stack" key={n.id}>
                <span>{n.body}</span>
                <small className="a-sub">{`${n.authorLabel} · ${formatDateTimeVi(n.createdAt)}`}</small>
              </li>
            ))}
          </ul>
        ) : null}
        <NoteForm id={reservation.id} />
      </section>

      {/* The booking's emails (R2): history lives in email_outbox, beside the timeline; the full address shows here (R12). */}
      <section aria-labelledby="res-emails-title">
        <h2 id="res-emails-title">Email</h2>
        {emails.length === 0 ? (
          <p className="a-muted">Chưa có email nào cho đặt bàn này.</p>
        ) : (
          <div className="a-table-scroll">
            <table className="a-table a-table--compact" aria-label="Email của đặt bàn">
              <thead>
                <tr>
                  <th scope="col">Loại</th>
                  <th scope="col">Người nhận</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Lỗi gần nhất</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {EMAIL_EVENT_LABELS[m.event]}
                      <small className="a-sub">{formatDateTimeVi(m.createdAt)}</small>
                    </td>
                    <td>
                      {m.toEmail}
                      <small className="a-sub">{m.locale}</small>
                    </td>
                    <td>
                      <EmailStatusBadge status={m.status} />
                      {m.sentAt ? <small className="a-sub">{formatDateTimeVi(m.sentAt)}</small> : null}
                      <small className="a-sub">{`${m.attempts} lần gửi`}</small>
                    </td>
                    <td>{m.lastError ? <span className="a-error-text">{redactEmails(m.lastError)}</span> : '—'}</td>
                    <td>{canResend && resendable(m.status) ? <ResendEmail id={m.id} label={EMAIL_EVENT_LABELS[m.event]} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="res-timeline-title">
        <h2 id="res-timeline-title">Dòng thời gian</h2>
        <ol className="a-timeline" aria-label="Dòng thời gian">
          {events.map((e) => {
            const changes = e.type === 'edited' ? describeChanges(e.changes) : null;
            return (
              <li key={e.id}>
                <time>{formatDateTimeVi(e.at)}</time>
                <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
                {e.type === 'status_changed' || e.type === 'created'
                  ? ` ${e.fromStatus ? `${STATUS_LABELS[e.fromStatus]} → ` : ''}${e.toStatus ? STATUS_LABELS[e.toStatus] : ''}`
                  : null}
                {changes ? <span className="a-sub">{changes}</span> : null}
                {e.reason ? <span className="a-sub">{`Lý do: ${e.reason}`}</span> : null}
                <span className="a-sub">{e.actorLabel ?? (e.actorKind === 'guest' ? 'Khách' : 'Hệ thống')}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
