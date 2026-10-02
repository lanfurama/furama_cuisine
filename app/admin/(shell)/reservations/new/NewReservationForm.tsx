'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { isValidIsoDate } from '@/lib/venue-time';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { createReservation } from '../actions';
import { usePickedTarget } from './TargetPicker';

export type SlotOption = { time: string; label: string };

/*
 * Posts to the target the page was rendered for (the hidden restaurant and
 * date), which the line at the top names. The page keys this form on that
 * target, so a new pick remounts it with the new times.
 *
 * "Gửi email xác nhận" (spec §10.3, R8) is on by default for a phone booking
 * and hidden for a walk-in, who is already at the table. Hidden, not
 * unmounted: remounted, it would come back ticked after staff had unticked it
 * for a guest who wants no email and slipped onto "Khách vãng lai" and back.
 * A walk-in still posts it; the server sends a walk-in nothing (outboxEffects).
 */
export function NewReservationForm(props: {
  restaurantId: string;
  restaurantName: string;
  date: string;
  dateLabel: string;
  walkInAllowed: boolean;
  slots: SlotOption[];
  locales: { code: string; name: string }[];
  defaultLocale: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createReservation, null);
  const picked = usePickedTarget();
  const [refused, setRefused] = useState(false);
  const [walkIn, setWalkIn] = useState(false);
  const err = (name: string) => `res-new-${name}-error`;
  // The picker no longer shows this form's target: its times are the old target's, so posting would book there.
  const stale = !!picked && (picked.restaurant !== props.restaurantId || picked.date !== props.date);
  const submit = submitKeepingValues(action);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (stale) {
      event.preventDefault();
      setRefused(true);
      return;
    }
    setRefused(false);
    submit(event);
  };
  return (
    <form className="a-grid-form" method="post" onSubmit={onSubmit} noValidate aria-label="Đặt bàn mới">
      <input type="hidden" name="restaurant" value={props.restaurantId} />
      <input type="hidden" name="date" value={props.date} />
      <FormMessage state={state} />
      {/* Where this booking goes, said where staff act; a refused date (past, or walk-in not today) is reported here. */}
      <div className="a-field a-field--wide">
        <p className="a-target">{`Đặt tại: ${props.restaurantName} · ${props.dateLabel}`}</p>
        <FieldError state={state} name="restaurant" id={err('restaurant')} />
        <FieldError state={state} name="date" id={err('date')} />
      </div>
      <fieldset className="a-field a-field--wide">
        <legend>Nguồn</legend>
        <label className="a-check">
          <input type="radio" name="source" value="phone" defaultChecked onChange={() => setWalkIn(false)} />
          Điện thoại (đã xác nhận)
        </label>
        <label className="a-check">
          <input type="radio" name="source" value="walk_in" disabled={!props.walkInAllowed} onChange={() => setWalkIn(true)} />
          Khách vãng lai (đã đến)
        </label>
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
        <label className="a-check" hidden={walkIn}>
          <input type="checkbox" name="notifyGuest" defaultChecked />
          Gửi email xác nhận cho khách (khi có email)
        </label>
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
      {refused && stale ? (
        <p className="a-alert" role="alert">
          {picked && !isValidIsoDate(picked.date)
            ? 'Chọn ngày ở ô Ngày phía trên, rồi bấm lại.'
            : 'Đang tải giờ trống của nhà hàng và ngày vừa chọn; bấm lại khi danh sách giờ hiện ra.'}
        </p>
      ) : null}
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang tạo…' : 'Tạo đặt bàn'}
      </button>
    </form>
  );
}
