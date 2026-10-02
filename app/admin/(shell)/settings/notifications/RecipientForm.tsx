'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { STAFF_EMAIL_EVENTS } from '@/lib/email/events';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addRecipient, editRecipient, removeRecipient } from './actions';

export type RecipientValues = {
  id: string;
  token: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  email: string;
  events: string[];
  locale: string;
  active: boolean;
};

export type RecipientOptions = {
  restaurants: { id: string; name: string }[];
  destinations: { id: string; name: string }[];
  locales: { code: string; name: string }[];
};

const STAFF_EVENT_LABELS: Record<(typeof STAFF_EMAIL_EVENTS)[number], string> = { 'staff.new': 'Đặt bàn online mới' };

/*
 * Add (values = null) or edit one recipient. Like ClosureEditor (code rule 9): the action's state
 * lives here and the fields remount on the row's token, or after each successful add, so they never
 * post a stale target beside a newer token, and the message survives the remount.
 */
export function RecipientEditor({ options, values }: { options: RecipientOptions; values: RecipientValues | null }) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    (prev, formData) => (values ? editRecipient(prev as ActionResult | null, formData) : addRecipient(prev as ActionResult<{ id: string }> | null, formData)),
    null,
  );
  const [added, setAdded] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok && !values) setAdded((n) => n + 1);
  }
  const uid = useId();
  return (
    <RecipientFields
      key={values ? `token-${values.token}` : `added-${added}`}
      uid={uid}
      options={options}
      values={values}
      state={state}
      action={action}
      pending={pending}
    />
  );
}

function RecipientFields({
  uid,
  options,
  values,
  state,
  action,
  pending,
}: {
  uid: string;
  options: RecipientOptions;
  values: RecipientValues | null;
  state: ActionResult<unknown> | null;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [scope, setScope] = useState(values?.scope ?? 'restaurant');
  const id = (name: string) => `${uid}-${name}`;
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label={values ? `Sửa người nhận ${values.email}` : 'Thêm người nhận'}>
      {values ? (
        <>
          <input type="hidden" name="id" value={values.id} />
          <input type="hidden" name="token" value={values.token} />
        </>
      ) : null}
      <FormMessage state={state} success={values ? 'Đã lưu.' : 'Đã thêm người nhận.'} />
      <div className="a-field">
        <label htmlFor={id('email')}>Email người nhận</label>
        <input id={id('email')} name="email" type="email" autoComplete="off" maxLength={254} defaultValue={values?.email} aria-describedby={id('email-error')} />
        <FieldError state={state} name="email" id={id('email-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('scope')}>Nhận thông báo của</label>
        <select id={id('scope')} name="scope" value={scope} onChange={(e) => setScope(e.currentTarget.value as RecipientValues['scope'])}>
          <option value="restaurant">Một nhà hàng</option>
          <option value="destination">Một điểm đến</option>
          <option value="all">Tất cả nhà hàng</option>
        </select>
      </div>
      {scope === 'restaurant' ? (
        <div className="a-field">
          <label htmlFor={id('restaurant')}>Nhà hàng</label>
          <select id={id('restaurant')} name="restaurantId" defaultValue={values?.restaurantId ?? ''} aria-describedby={id('restaurant-error')}>
            <option value="">Chọn nhà hàng</option>
            {options.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="restaurantId" id={id('restaurant-error')} />
        </div>
      ) : null}
      {scope === 'destination' ? (
        <div className="a-field">
          <label htmlFor={id('destination')}>Điểm đến</label>
          <select id={id('destination')} name="destinationId" defaultValue={values?.destinationId ?? ''} aria-describedby={id('destination-error')}>
            <option value="">Chọn điểm đến</option>
            {options.destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="destinationId" id={id('destination-error')} />
        </div>
      ) : null}
      <div className="a-field">
        <label htmlFor={id('locale')}>Ngôn ngữ của email</label>
        <select id={id('locale')} name="locale" defaultValue={values?.locale ?? 'vi'}>
          {options.locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="a-field a-field--wide">
        <legend>Loại thông báo</legend>
        {STAFF_EMAIL_EVENTS.map((event) => (
          <label className="a-check" key={event}>
            <input type="checkbox" name="events" value={event} defaultChecked={values ? values.events.includes(event) : true} />
            {STAFF_EVENT_LABELS[event]}
          </label>
        ))}
        <FieldError state={state} name="events" id={id('events-error')} />
      </fieldset>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="active" defaultChecked={values?.active ?? true} />
        Đang nhận thông báo
      </label>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : values ? 'Lưu' : 'Thêm người nhận'}
      </button>
    </form>
  );
}

export function DeleteRecipient({ values }: { values: RecipientValues }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(removeRecipient, null);
  // The confirm sits on the button, as in DeleteClosure: a form with a function action takes no onSubmit.
  return (
    <form className="a-inline" action={action}>
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="token" value={values.token} />
      <button
        className="a-btn a-btn--ghost a-btn--small"
        type="submit"
        disabled={pending}
        aria-label={`Xóa người nhận ${values.email}`}
        onClick={(e) => {
          if (!window.confirm(`Xóa ${values.email} khỏi danh sách nhận thông báo?`)) e.preventDefault();
        }}
      >
        Xóa
      </button>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}
