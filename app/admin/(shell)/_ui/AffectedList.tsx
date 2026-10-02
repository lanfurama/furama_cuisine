'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { cancelReservations, type CancelManyResult } from '../reservations/actions';
import { FieldError, FormMessage } from './FormMessage';

export type AffectedItem = {
  id: string;
  version: number;
  reference: string;
  restaurantName: string;
  dayLabel: string;
  time: string;
  guests: number;
  name: string;
  /** As the guest gave it: the row's link to call them. */
  phone: string;
  /** The guest gave an email: with "Báo khách qua email" ticked, the cancel sends them the reason. */
  hasEmail: boolean;
  statusLabel: string;
  /** Why it is listed, in Vietnamese. */
  why: string;
};

/** A number as typed, as a tel: link (digits and a leading +). */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/*
 * Bookings that new hours, a new capacity or a closure leave out (spec §10.1).
 * Nothing is ticked at first, and nothing is cancelled unless staff tick it,
 * write a reason and press the button: never automatic. "Báo khách qua email"
 * is on by default, as for a single cancel (R8): each guest who gave an
 * address gets guest.cancelled with the reason, and the reason field says so
 * while a ticked booking has one. Email is optional, so each row has the
 * number to call and marks a guest without an address, and the outcome names
 * every cancelled guest who was not emailed (B4): a guest told nothing would
 * come to a closed restaurant.
 */
export function AffectedList({ items, title }: { items: AffectedItem[]; title: string }) {
  const [state, action, pending] = useActionState<ActionResult<CancelManyResult> | null, FormData>(cancelReservations, null);
  const uid = useId();
  const formKey = items.map((i) => `${i.id}:${i.version}`).join();
  // "Lý do này sẽ được gửi cho khách." only while an email will quote it: the box on and a ticked booking whose
  // guest gave an address. Read from the form at each change; a new list (the form's key) starts with nothing ticked.
  const emailed = new Set(items.filter((i) => i.hasEmail).map((i) => `${i.id}:${i.version}`));
  const [hintAt, setHintAt] = useState({ formKey, on: false });
  const hint = hintAt.formKey === formKey && hintAt.on;
  const done = state?.ok ? state.data : null;
  // The guests to phone live in the outcome, not the list: refresh() has already taken their rows away.
  const notice = done ? (
    <div className="a-notice" role="status">
      <p>{`Đã hủy ${done.cancelled} đặt bàn${done.skipped ? `; ${done.skipped} đặt bàn vừa thay đổi nên chưa hủy, hãy xem lại` : ''}.`}</p>
      {done.notTold.length > 0 ? (
        <>
          <p>{`${done.notTold.length} khách chưa được báo qua email, hãy gọi điện:`}</p>
          <ul>
            {done.notTold.map((guest) => (
              <li key={guest.reference}>
                {`${guest.reference} ${guest.name} · `}
                <a href={telHref(guest.phone)}>{guest.phone}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  ) : null;
  // The cancel re-renders the page (refresh()): once nothing is left the list goes, and the outcome stays.
  if (items.length === 0) {
    return (
      <div className="a-affected" role="group" aria-label={title}>
        {notice}
        <p className="a-muted">Không có đặt bàn nào bị ảnh hưởng.</p>
      </div>
    );
  }
  return (
    // submitKeepingValues: a refused cancel (no reason, nothing ticked) keeps the ticks and the reason, where
    // action={action} would reset them. The key clears them once a cancel changes the list (refresh()): a
    // booking skipped because it changed comes back with a new version and must not stay ticked. The hook
    // state lives above the form, so the outcome notice survives. method="post": never a GET before hydration.
    <form
      className="a-affected"
      method="post"
      onSubmit={submitKeepingValues(action)}
      onChange={(e) => {
        const data = new FormData(e.currentTarget);
        setHintAt({ formKey, on: data.has('notifyGuest') && data.getAll('item').some((v) => emailed.has(String(v))) });
      }}
      key={formKey}
      aria-label={title}
    >
      <p className="a-warn">{`${items.length} đặt bàn bị ảnh hưởng. Hệ thống không tự hủy: chọn những đặt bàn cần hủy, ghi lý do rồi bấm Hủy.`}</p>
      <table className="a-table a-table--compact">
        <thead>
          <tr>
            <th scope="col">Chọn</th>
            <th scope="col">Mã</th>
            <th scope="col">Nhà hàng</th>
            <th scope="col">Ngày giờ</th>
            <th scope="col">Khách</th>
            <th scope="col">Liên hệ</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Lý do</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <input type="checkbox" name="item" value={`${item.id}:${item.version}`} aria-label={`Chọn ${item.reference}`} />
              </td>
              <td className="a-ref">
                <Link href={`/admin/reservations/${item.id}`}>{item.reference}</Link>
              </td>
              <td>{item.restaurantName}</td>
              <td>{`${item.dayLabel} ${item.time}`}</td>
              <td>{`${item.name} · ${item.guests}`}</td>
              <td>
                <a href={telHref(item.phone)}>{item.phone}</a>
                {item.hasEmail ? null : <span className="a-tag">không có email</span>}
              </td>
              <td>{item.statusLabel}</td>
              <td>{item.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-field">
        <label htmlFor={`${uid}-reason`}>Lý do hủy</label>
        <input
          id={`${uid}-reason`}
          name="reason"
          maxLength={500}
          aria-describedby={hint ? `${uid}-reason-hint ${uid}-reason-error` : `${uid}-reason-error`}
        />
        {hint ? (
          <small className="a-sub" id={`${uid}-reason-hint`}>
            Lý do này sẽ được gửi cho khách.
          </small>
        ) : null}
        <FieldError state={state} name="reason" id={`${uid}-reason-error`} />
        <label className="a-check">
          <input type="checkbox" name="notifyGuest" defaultChecked />
          Báo khách qua email (khách có email)
        </label>
        <FieldError state={state} name="items" id={`${uid}-items-error`} />
      </div>
      {notice ?? <FormMessage state={state && !state.ok ? state : null} />}
      <button className="a-btn a-btn--danger" type="submit" disabled={pending}>
        {pending ? 'Đang hủy…' : 'Hủy các đặt bàn đã chọn'}
      </button>
    </form>
  );
}
