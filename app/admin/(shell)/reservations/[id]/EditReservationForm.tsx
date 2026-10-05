'use client';

import { useActionState, useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage, invalidField } from '../../_ui/FormMessage';
import { updateReservation } from '../actions';

type Editable = { id: string; version: number; date: string; time: string; guests: number; name: string; phone: string; email: string; note: string };

/*
 * Date, time, party and the guest's details; a move or a larger party is re-checked against capacity.
 *
 * Keyed on its own values, not the version: a status change (the panel above, or a colleague's) moves
 * the version too, and a version key threw away what staff were typing here, so the next save said
 * "Không có gì thay đổi" (phase-4 ledger ADM-1). A save of these values, here or elsewhere, still
 * redraws the fields from the booking as it is now; the hidden version always posts the newest, which
 * is honest: the values the form holds are that version's, or the key would have changed. Ids come
 * from useId (phase-5 ledger: an earlier booking's page can stay mounted, hidden, in <Activity>).
 */
export function EditReservationForm({ reservation: r, times }: { reservation: Editable; times: string[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ changed: boolean }> | null, FormData>(updateReservation, null);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const err = (name: string) => `${uid}-${name}-error`;
  const invalid = (name: string) => invalidField(state, name);
  const values = [r.date, r.time, r.guests, r.name, r.phone, r.email, r.note].join('|');
  return (
    // No reset on submit: a refused edit (full, conflict) keeps what was typed; the hook state above the form stays.
    <form className="a-grid-form" method="post" onSubmit={submitKeepingValues(action)} key={values} noValidate aria-label="Sửa đặt bàn">
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="version" value={r.version} />
      <FormMessage state={state} success={state?.ok && !state.data.changed ? 'Không có gì thay đổi.' : 'Đã lưu.'} />
      <div className="a-field">
        <label htmlFor={id('date')}>Ngày</label>
        <input id={id('date')} name="date" type="date" defaultValue={r.date} aria-describedby={err('date')} aria-invalid={invalid('date')} />
        <FieldError state={state} name="date" id={err('date')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('time')}>Giờ</label>
        <select id={id('time')} name="time" defaultValue={r.time} aria-describedby={err('time')} aria-invalid={invalid('time')}>
          {times.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <FieldError state={state} name="time" id={err('time')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('guests')}>Số khách</label>
        <input id={id('guests')} name="guests" type="number" min={1} max={50} defaultValue={r.guests} aria-describedby={err('guests')} aria-invalid={invalid('guests')} />
        <FieldError state={state} name="guests" id={err('guests')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('name')}>Tên khách</label>
        <input id={id('name')} name="name" defaultValue={r.name} aria-describedby={err('name')} aria-invalid={invalid('name')} />
        <FieldError state={state} name="name" id={err('name')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('phone')}>Điện thoại</label>
        <input id={id('phone')} name="phone" type="tel" defaultValue={r.phone} aria-describedby={err('phone')} aria-invalid={invalid('phone')} />
        <FieldError state={state} name="phone" id={err('phone')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('email')}>Email</label>
        <input id={id('email')} name="email" type="email" defaultValue={r.email} aria-describedby={err('email')} aria-invalid={invalid('email')} />
        <FieldError state={state} name="email" id={err('email')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor={id('note')}>Yêu cầu của khách</label>
        <textarea id={id('note')} name="note" rows={2} defaultValue={r.note} maxLength={1000} aria-describedby={err('note')} aria-invalid={invalid('note')} />
        <FieldError state={state} name="note" id={err('note')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor={id('over')}>Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)</label>
        <input id={id('over')} name="overCapacityReason" maxLength={500} aria-describedby={err('overCapacityReason')} aria-invalid={invalid('overCapacityReason')} />
        <FieldError state={state} name="overCapacityReason" id={err('overCapacityReason')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
      </button>
    </form>
  );
}
