'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addClosure, editClosure, removeClosure } from './actions';

export type ClosureValues = {
  id: string;
  token: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  startsOn: string;
  endsOn: string;
  meals: string[];
  showReason: boolean;
  reasonEn: string;
  reasonVi: string;
  internalNote: string;
};

type Options = { restaurants: { id: string; name: string }[]; destinations: { id: string; name: string }[]; meals: string[] };

/** The closure's scope when the page was drawn, so the action can expire those restaurants' rules too. */
function WasScope({ values }: { values: ClosureValues }) {
  return (
    <>
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="token" value={values.token} />
      <input type="hidden" name="was_scope" value={values.scope} />
      <input type="hidden" name="was_destination" value={values.destinationId ?? ''} />
      <input type="hidden" name="was_restaurant" value={values.restaurantId ?? ''} />
    </>
  );
}

/* Add (values = null) or edit one closure. Several render on the page, so their ids come from useId. */
export function ClosureEditor({ options, values }: { options: Options; values: ClosureValues | null }) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    (prev, formData) => (values ? editClosure(prev as ActionResult | null, formData) : addClosure(prev as ActionResult<{ id: string }> | null, formData)),
    null,
  );
  const [scope, setScope] = useState(values?.scope ?? 'restaurant');
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  // The add form starts blank again once a closure is saved (it submits without React's reset).
  useEffect(() => {
    if (!values && state?.ok) form.current?.reset();
  }, [state, values]);
  const id = (name: string) => `${uid}-${name}`;
  return (
    <form ref={form} className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label={values ? 'Sửa ngày đóng cửa' : 'Thêm ngày đóng cửa'}>
      {values ? <WasScope values={values} /> : <h2 className="a-field--wide">Thêm ngày đóng cửa</h2>}
      <FormMessage state={state} success={values ? 'Đã lưu.' : 'Đã thêm ngày đóng cửa.'} />
      <div className="a-field">
        <label htmlFor={id('scope')}>Phạm vi</label>
        <select id={id('scope')} name="scope" value={scope} onChange={(e) => setScope(e.currentTarget.value as ClosureValues['scope'])}>
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
        <label htmlFor={id('starts')}>Từ ngày</label>
        <input id={id('starts')} name="startsOn" type="date" defaultValue={values?.startsOn} aria-describedby={id('starts-error')} />
        <FieldError state={state} name="startsOn" id={id('starts-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('ends')}>Đến ngày</label>
        <input id={id('ends')} name="endsOn" type="date" defaultValue={values?.endsOn} aria-describedby={id('ends-error')} />
        <FieldError state={state} name="endsOn" id={id('ends-error')} />
      </div>
      <fieldset className="a-field a-field--wide">
        <legend>Bữa đóng cửa (không chọn: cả ngày)</legend>
        {options.meals.map((m) => (
          <label className="a-check" key={m}>
            <input type="checkbox" name="meals" value={m} defaultChecked={values?.meals.includes(m)} />
            {m}
          </label>
        ))}
      </fieldset>
      <div className="a-field">
        <label htmlFor={id('reason-en')}>Lý do cho khách (EN)</label>
        <input id={id('reason-en')} name="reasonEn" maxLength={160} defaultValue={values?.reasonEn} aria-describedby={id('reason-en-error')} />
        <FieldError state={state} name="reasonEn" id={id('reason-en-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('reason-vi')}>Lý do cho khách (VI)</label>
        <input id={id('reason-vi')} name="reasonVi" maxLength={160} defaultValue={values?.reasonVi} aria-describedby={id('reason-vi-error')} />
        <FieldError state={state} name="reasonVi" id={id('reason-vi-error')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="showReason" defaultChecked={values?.showReason ?? true} />
        Hiện lý do cho khách
      </label>
      <div className="a-field a-field--wide">
        <label htmlFor={id('note')}>Ghi chú nội bộ (khách không thấy)</label>
        <input id={id('note')} name="internalNote" maxLength={2000} defaultValue={values?.internalNote} aria-describedby={id('note-error')} />
        <FieldError state={state} name="internalNote" id={id('note-error')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : values ? 'Lưu' : 'Thêm ngày đóng cửa'}
      </button>
    </form>
  );
}

export function DeleteClosure({ values }: { values: ClosureValues }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(removeClosure, null);
  return (
    <form
      className="a-inline"
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Xóa ngày đóng cửa này? Khách sẽ đặt được bàn lại vào những ngày đó.')) e.preventDefault();
      }}
    >
      <WasScope values={values} />
      <button className="a-btn a-btn--ghost a-btn--small" type="submit" disabled={pending}>
        Xóa ngày đóng cửa
      </button>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}
