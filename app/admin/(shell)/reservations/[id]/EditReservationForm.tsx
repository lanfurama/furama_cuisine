'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { updateReservation } from '../actions';

type Editable = { id: string; version: number; date: string; time: string; guests: number; name: string; phone: string; email: string; note: string };

/* Date, time, party and the guest's details; a move or a larger party is re-checked against capacity. */
export function EditReservationForm({ reservation: r, times }: { reservation: Editable; times: string[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ changed: boolean }> | null, FormData>(updateReservation, null);
  const err = (name: string) => `res-edit-${name}-error`;
  return (
    // No reset on submit: a refused edit (full, conflict) keeps what was typed. A saved one re-renders with
    // the new version, and the key gives the inputs their saved values; the hook state above the form stays.
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} key={r.version} noValidate aria-label="Sửa đặt bàn">
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="version" value={r.version} />
      <FormMessage state={state} success={state?.ok && !state.data.changed ? 'Không có gì thay đổi.' : 'Đã lưu.'} />
      <div className="a-field">
        <label htmlFor="res-edit-date">Ngày</label>
        <input id="res-edit-date" name="date" type="date" defaultValue={r.date} aria-describedby={err('date')} />
        <FieldError state={state} name="date" id={err('date')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-time">Giờ</label>
        <select id="res-edit-time" name="time" defaultValue={r.time} aria-describedby={err('time')}>
          {times.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <FieldError state={state} name="time" id={err('time')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-guests">Số khách</label>
        <input id="res-edit-guests" name="guests" type="number" min={1} max={50} defaultValue={r.guests} aria-describedby={err('guests')} />
        <FieldError state={state} name="guests" id={err('guests')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-name">Tên khách</label>
        <input id="res-edit-name" name="name" defaultValue={r.name} aria-describedby={err('name')} />
        <FieldError state={state} name="name" id={err('name')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-phone">Điện thoại</label>
        <input id="res-edit-phone" name="phone" type="tel" defaultValue={r.phone} aria-describedby={err('phone')} />
        <FieldError state={state} name="phone" id={err('phone')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-email">Email</label>
        <input id="res-edit-email" name="email" type="email" defaultValue={r.email} aria-describedby={err('email')} />
        <FieldError state={state} name="email" id={err('email')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-edit-note">Yêu cầu của khách</label>
        <textarea id="res-edit-note" name="note" rows={2} defaultValue={r.note} maxLength={1000} aria-describedby={err('note')} />
        <FieldError state={state} name="note" id={err('note')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-edit-over">Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)</label>
        <input id="res-edit-over" name="overCapacityReason" maxLength={500} aria-describedby={err('overCapacityReason')} />
        <FieldError state={state} name="overCapacityReason" id={err('overCapacityReason')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
      </button>
    </form>
  );
}
