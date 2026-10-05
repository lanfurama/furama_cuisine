'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage, invalidField } from '../../_ui/FormMessage';
import { addNote } from '../actions';

/*
 * An internal note. A refused note (blank, a lapsed session) keeps what was
 * typed: submitKeepingValues, where action={action} reset the field whatever
 * the answer (phase-4 ledger T9). A saved note starts the field over: it is
 * keyed on the notes saved here, counted during render when the result
 * arrives, while the action's state above it keeps the notice. Ids from
 * useId (several booking pages can stay mounted, phase-5 ledger).
 */
export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addNote, null);
  const [saved, setSaved] = useState({ state, count: 0 });
  if (saved.state !== state) setSaved({ state, count: saved.count + (state?.ok ? 1 : 0) });
  const uid = useId();
  return (
    <form className="a-inline-form" method="post" onSubmit={submitKeepingValues(action)} aria-label="Thêm ghi chú nội bộ">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <div className="a-field">
        <label htmlFor={`${uid}-body`}>Thêm ghi chú</label>
        <textarea
          key={saved.count}
          id={`${uid}-body`}
          name="body"
          rows={2}
          maxLength={2000}
          aria-describedby={`${uid}-body-error`}
          aria-invalid={invalidField(state, 'body')}
        />
        <FieldError state={state} name="body" id={`${uid}-body-error`} />
      </div>
      <button className="a-btn a-btn--ghost" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu ghi chú'}
      </button>
    </form>
  );
}
