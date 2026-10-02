'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { createReservation } from '../actions';

export type SlotOption = { time: string; label: string };

export function NewReservationForm(props: {
  restaurantId: string;
  date: string;
  walkInAllowed: boolean;
  slots: SlotOption[];
  locales: { code: string; name: string }[];
  defaultLocale: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createReservation, null);
  const err = (name: string) => `res-new-${name}-error`;
  return (
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label="Đặt bàn mới">
      <input type="hidden" name="restaurant" value={props.restaurantId} />
      <input type="hidden" name="date" value={props.date} />
      <FormMessage state={state} />
      <fieldset className="a-field a-field--wide">
        <legend>Nguồn</legend>
        <label className="a-check">
          <input type="radio" name="source" value="phone" defaultChecked />
          Điện thoại (đã xác nhận)
        </label>
        <label className="a-check">
          <input type="radio" name="source" value="walk_in" disabled={!props.walkInAllowed} />
          Khách vãng lai (đã đến)
        </label>
        <FieldError state={state} name="date" id={err('date')} />
      </fieldset>
      <div className="a-field">
        <label htmlFor="res-new-time">Giờ</label>
        <select id="res-new-time" name="time" aria-describedby={err('time')}>
          {props.slots.map((s) => (
            <option key={s.time} value={s.time}>
              {s.label}
            </option>
          ))}
        </select>
        <FieldError state={state} name="time" id={err('time')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-guests">Số khách</label>
        <input id="res-new-guests" name="guests" type="number" min={1} max={50} defaultValue={2} aria-describedby={err('guests')} />
        <FieldError state={state} name="guests" id={err('guests')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-name">Tên khách</label>
        <input id="res-new-name" name="name" aria-describedby={err('name')} />
        <FieldError state={state} name="name" id={err('name')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-phone">Điện thoại</label>
        <input id="res-new-phone" name="phone" type="tel" aria-describedby={err('phone')} />
        <FieldError state={state} name="phone" id={err('phone')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-email">Email (không bắt buộc)</label>
        <input id="res-new-email" name="email" type="email" aria-describedby={err('email')} />
        <FieldError state={state} name="email" id={err('email')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-locale">Ngôn ngữ của khách</label>
        <select id="res-new-locale" name="locale" defaultValue={props.defaultLocale} aria-describedby={err('locale')}>
          {props.locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <FieldError state={state} name="locale" id={err('locale')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-new-note">Yêu cầu của khách</label>
        <textarea id="res-new-note" name="note" rows={2} maxLength={1000} aria-describedby={err('note')} />
        <FieldError state={state} name="note" id={err('note')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-new-over">Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)</label>
        <input id="res-new-over" name="overCapacityReason" maxLength={500} aria-describedby={err('overCapacityReason')} />
        <FieldError state={state} name="overCapacityReason" id={err('overCapacityReason')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang tạo…' : 'Tạo đặt bàn'}
      </button>
    </form>
  );
}
