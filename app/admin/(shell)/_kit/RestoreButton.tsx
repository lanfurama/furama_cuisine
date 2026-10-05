'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage, RuleAlert, fieldMessages } from '../_ui/FormMessage';
import { useRestoreReport } from './RestoreOutcome';

type Restore = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/*
 * "Khôi phục phiên bản này" (spec §7.5). The action runs the editor's own
 * save flow with action 'restore'; `token` is the record's as this page
 * drew it, so a restore over a newer edit is a conflict like any save. A
 * function action takes no onSubmit (phase-4 ruling): the confirm is the
 * button's. A version today's rules refuse (code rule 5) says which rule: a
 * restore has no fields to mark, so "kiểm tra các ô được đánh dấu" would
 * point at nothing. A success is reported to the panel's RestoreOutcome,
 * which outlives this button (UX-5); outside one, the button says it itself.
 */
export function RestoreButton({
  action,
  id,
  auditId,
  side,
  token,
  label,
  when,
}: {
  action: Restore;
  id: string;
  auditId: string;
  side: 'before' | 'after';
  token: string;
  label: string;
  /** "08:15 05/10/2026", for the confirm and the button's accessible name. */
  when: string;
}) {
  const report = useRestoreReport();
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) report?.(`Đã khôi phục: ${label.charAt(0).toLowerCase()}${label.slice(1)} lúc ${when}.`);
    return result;
  }, null);
  const rules = state && !state.ok && state.code === 'invalid' ? fieldMessages(state) : [];
  return (
    <form action={dispatch} className="a-inline-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="auditId" value={auditId} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        className="a-btn a-btn--ghost a-btn--small"
        disabled={pending}
        aria-label={`${label} (${when})`}
        onClick={(e) => {
          if (!window.confirm(`${label} lúc ${when}? Nội dung hiện tại sẽ được thay, và vẫn khôi phục lại được từ Lịch sử.`)) e.preventDefault();
        }}
      >
        {pending ? 'Đang khôi phục…' : label}
      </button>
      {rules.length ? <RuleAlert lead="Không khôi phục được phiên bản này:" rules={rules} /> : <FormMessage state={state} success={report ? undefined : 'Đã khôi phục.'} />}
    </form>
  );
}
