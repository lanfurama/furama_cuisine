'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addNote } from '../actions';

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addNote, null);
  return (
    <form className="a-inline-form" action={action} aria-label="Thêm ghi chú nội bộ">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <div className="a-field">
        <label htmlFor="res-note-body">Thêm ghi chú</label>
        <textarea id="res-note-body" name="body" rows={2} maxLength={2000} aria-describedby="res-note-body-error" />
        <FieldError state={state} name="body" id="res-note-body-error" />
      </div>
      <button className="a-btn a-btn--ghost" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu ghi chú'}
      </button>
    </form>
  );
}
