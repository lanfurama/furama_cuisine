import 'server-only';
import { z } from '@/lib/admin/zod';
import { PermissionError } from '@/lib/server/dal/session';

/*
 * What every admin Server Action returns (spec §7.4), and how a thrown error
 * becomes one. Actions never throw to the client: a PermissionError is
 * `forbidden` (unauthenticated included: the browser learns nothing more), a
 * ZodError is `invalid` with Vietnamese field messages, anything else is a
 * logged `db_error` whose message is never echoed.
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
  | 'invalid_token';

export type ActionFailure = { ok: false; code: ActionCode; fieldErrors?: Record<string, string[] | undefined> };
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function actionError(err: unknown): ActionFailure {
  if (err instanceof PermissionError) return { ok: false, code: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, code: 'invalid', fieldErrors: z.flattenError(err).fieldErrors };
  console.error('[admin] action failed', { code: 'db_error', name: err instanceof Error ? err.name : typeof err });
  return { ok: false, code: 'db_error' };
}
