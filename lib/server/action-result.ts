import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { z } from '@/lib/admin/zod';
import { PermissionError } from '@/lib/server/dal/session';

/*
 * What every admin Server Action returns (spec §7.4, §6.3.5), and how a thrown
 * error becomes one. Actions never throw to the client: a PermissionError is
 * `forbidden` (unauthenticated included: the browser learns nothing more), a
 * ZodError is `invalid` with Vietnamese field messages, anything else is a
 * logged `db_error` whose message is never echoed. Next's own control-flow
 * throws (redirect(), notFound(), forbidden()) pass straight through, so an
 * action may call redirect() inside its try.
 */
export type ActionCode =
  | 'forbidden'
  | 'invalid'
  | 'db_error'
  | 'already_staff'
  | 'already_invited'
  | 'not_found'
  | 'last_admin'
  | 'self'
  | 'invalid_token'
  // Reservations and booking configuration (spec §10.2, §10.3, §12).
  /** Someone else saved first (version / updated_at); params.by and params.at say who and when. */
  | 'conflict'
  /** No transition from the current status to the requested one. */
  | 'not_allowed'
  /** Outside the transition's time window (seated from 60 min before, no-show 15 min after, corrections same service day). */
  | 'too_early'
  | 'too_late'
  /** The slot has no room; params.left says how many covers remain. Staff may still book with a reason. */
  | 'full'
  /** A closure takes out that service on that date. */
  | 'closed'
  /** The time is not a slot of that day's services. */
  | 'slot_unavailable'
  /** Same restaurant, date, time and phone as an active booking (reservations_dedupe_v2_idx). */
  | 'duplicate'
  // Email (spec §10.4).
  /** "Gửi lại" on an email that was sent, skipped, or is being sent right now. */
  | 'not_resendable'
  /** "Gửi email thử" did not go out; params.error is describeEmailError's "<code>: <message>" (no address). */
  | 'email_failed'
  // Content (spec §6.5, §7.5; R16).
  /** A layout limit (spec §6.5) would be passed; params.max is the limit. */
  | 'limit'
  /** A restore points at a restaurant, file or row that is gone since that version. */
  | 'missing_reference';

export type ActionFailure = {
  ok: false;
  code: ActionCode;
  params?: Record<string, string>;
  fieldErrors?: Record<string, string[] | undefined>;
};
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function actionError(err: unknown): ActionFailure {
  // First (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md:62):
  // redirect(), notFound() and forbidden() are not failures.
  unstable_rethrow(err);
  if (err instanceof PermissionError) return { ok: false, code: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, code: 'invalid', fieldErrors: z.flattenError(err).fieldErrors };
  console.error('[admin] action failed', { code: 'db_error', name: err instanceof Error ? err.name : typeof err });
  return { ok: false, code: 'db_error' };
}
