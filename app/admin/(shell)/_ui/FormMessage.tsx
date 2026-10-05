'use client';

import { useRouter } from 'next/navigation';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';

/*
 * The outcome of a form's last submit: the error, with a reload button when
 * someone else changed the record first (spec §12 "Hai người sửa cùng lúc"),
 * or a short success notice. A failure always shows its general line,
 * `invalid` included, so a field error is never silent, even for a field the
 * form does not show; the field messages render next to their fields.
 * `onReload` replaces the bare refresh for an editor on useSaveState, which
 * must drop its unsaved edits before it takes the newer record.
 */
export function FormMessage({ state, success, onReload }: { state: ActionResult<unknown> | null; success?: string; onReload?: () => void }) {
  const router = useRouter();
  if (!state) return null;
  if (state.ok) {
    return success ? (
      <p className="a-notice" role="status">
        {success}
      </p>
    ) : null;
  }
  return (
    <div className="a-alert" role="alert">
      {actionErrorMessage(state.code, state.params)}
      {state.code === 'conflict' || state.code === 'not_allowed' ? (
        <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={onReload ?? (() => router.refresh())}>
          Tải lại
        </button>
      ) : null}
    </div>
  );
}

/**
 * Every field message of a refused action, flattened, each once: for a
 * refusal whose fields are not on screen (a restore, a list's switch), where
 * the rule's own sentence is the only useful explanation.
 */
export function fieldMessages(state: ActionResult<unknown> | null): string[] {
  return state && !state.ok ? [...new Set(Object.values(state.fieldErrors ?? {}).flatMap((m) => m ?? []))] : [];
}

/** One alert for such a refusal: what failed, then the rules' sentences, all read out together. */
export function RuleAlert({ lead, rules }: { lead: string; rules: readonly string[] }) {
  return (
    <div className="a-alert" role="alert">
      <p>{lead}</p>
      <ul>
        {rules.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `aria-invalid` for a field the last submit refused: true, or nothing (the
 * attribute left off). Beside FieldError, so a refused field is announced as
 * invalid and found without matching its text (phase-4 ledger T9).
 */
export function invalidField(state: ActionResult<unknown> | null, name: string): true | undefined {
  return state && !state.ok && state.fieldErrors?.[name]?.length ? true : undefined;
}

/** The first error of one field, linked to its input by `id` (aria-describedby). */
export function FieldError({ state, name, id }: { state: ActionResult<unknown> | null; name: string; id: string }) {
  const message = state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
  return message ? (
    <p className="a-field-error" id={id}>
      {message}
    </p>
  ) : null;
}
