'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { useLeaveGuard } from '../../../_kit/useLeaveGuard';
import { FieldError, FormMessage, invalidField } from '../../../_ui/FormMessage';
import { saveRules } from './actions';

type Rules = { id: string; token: string; bookingEnabled: boolean; windowDays: number | null; leadMinutes: number | null; maxParty: number | null };
type Defaults = { windowDays: number; leadMinutes: number; maxParty: number };

/*
 * The booking switch and the overrides; a blank override follows "Cài đặt đặt bàn". Typed and not
 * saved, they hold the page: leaving it (the slot preview's "Xem" included) asks first (ADM-3). The
 * mark clears on a save here, or when the saved values change (the form then shows them).
 */
export function RulesForm({ restaurant: r, defaults }: { restaurant: Rules; defaults: Defaults }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveRules, null);
  const uid = useId();
  const err = (name: string) => `${uid}-${name}-error`;
  const values = `${r.bookingEnabled}|${r.windowDays}|${r.leadMinutes}|${r.maxParty}`;
  const [edits, setEdits] = useState({ values, state, dirty: false });
  if (edits.values !== values || edits.state !== state) setEdits({ values, state, dirty: edits.values === values && !state?.ok && edits.dirty });
  useLeaveGuard(edits.dirty);
  return (
    // key: this form's own values, not the token. Every save on the page (the periods editor's too) moves the
    // shared token (R16), and a token key reset unsaved input here to the old values, which a later save then
    // wrote back with "Đã lưu". Keyed on its data, the form still takes new values saved here or elsewhere;
    // the hook state above stays. The hidden token input below reads the new token either way.
    <form
      className="a-grid-form"
      method="post"
      onSubmit={submitKeepingValues(action)}
      onChange={() => setEdits((e) => (e.dirty ? e : { ...e, dirty: true }))}
      key={values}
      noValidate
      aria-label="Quy tắc đặt bàn"
    >
      <input type="hidden" name="restaurant" value={r.id} />
      <input type="hidden" name="token" value={r.token} />
      <FormMessage state={state} success="Đã lưu." />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="bookingEnabled" defaultChecked={r.bookingEnabled} />
        Nhận đặt bàn online (tắt thì ẩn nút RESERVE và bỏ nhà hàng khỏi form đặt bàn của khách)
      </label>
      <div className="a-field">
        <label htmlFor={`${uid}-window`}>Số ngày đặt trước</label>
        <input
          id={`${uid}-window`}
          name="windowDays"
          type="number"
          min={1}
          max={90}
          defaultValue={r.windowDays ?? ''}
          placeholder={`${defaults.windowDays} (mặc định)`}
          aria-describedby={err('windowDays')} aria-invalid={invalidField(state, 'windowDays')}
        />
        <FieldError state={state} name="windowDays" id={err('windowDays')} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-lead`}>Đặt trước tối thiểu (phút)</label>
        <input
          id={`${uid}-lead`}
          name="leadMinutes"
          type="number"
          min={0}
          max={1440}
          defaultValue={r.leadMinutes ?? ''}
          placeholder={`${defaults.leadMinutes} (mặc định)`}
          aria-describedby={err('leadMinutes')} aria-invalid={invalidField(state, 'leadMinutes')}
        />
        <FieldError state={state} name="leadMinutes" id={err('leadMinutes')} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-party`}>Số khách tối đa</label>
        <input
          id={`${uid}-party`}
          name="maxParty"
          type="number"
          min={1}
          max={50}
          defaultValue={r.maxParty ?? ''}
          placeholder={`${defaults.maxParty} (mặc định)`}
          aria-describedby={err('maxParty')} aria-invalid={invalidField(state, 'maxParty')}
        />
        <FieldError state={state} name="maxParty" id={err('maxParty')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu quy tắc'}
      </button>
    </form>
  );
}
