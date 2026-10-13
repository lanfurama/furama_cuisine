import 'server-only';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { z } from '@/lib/admin/zod';
import type { ActionCode } from '@/lib/server/action-result';
import { PermissionError } from '@/lib/server/dal/session';
import { AiError, type AiErrorCode } from './ai-error';
import { vertexErrorCode } from './errors';

const NO_STORE = { 'cache-control': 'no-store' };

/** Status per code (D4): the person's limits 429, budget 402, off/preview 409, a lost token 422, Vertex's own failures 502. */
const STATUS: Record<AiErrorCode, number> = {
  ai_rate_minute: 429,
  ai_rate_day: 429,
  ai_budget: 402,
  ai_off: 409,
  ai_preview: 409,
  ai_placeholder: 422,
  ai_auth: 502,
  ai_not_found: 502,
  ai_quota: 502,
  ai_bad_request: 502,
  ai_failed: 502,
};

/**
 * A route handler's answer to a refusal or failure: `{ code, message }` with the
 * Vietnamese message (the limits and budget read from the configuration), never
 * cached. A missing permission is 403 `forbidden`, a bad input 400 `invalid`;
 * anything else is read as a Vertex failure.
 */
export function aiErrorResponse(err: unknown): Response {
  let code: ActionCode;
  let status: number;
  let params: Record<string, string> | undefined;
  if (err instanceof PermissionError) {
    code = 'forbidden';
    status = 403;
  } else if (err instanceof z.ZodError) {
    code = 'invalid';
    status = 400;
  } else {
    const ai = err instanceof AiError ? err : new AiError(vertexErrorCode(err));
    if (!(err instanceof AiError)) console.error('[ai] request failed', { code: ai.code, name: err instanceof Error ? err.name : typeof err });
    code = ai.code;
    status = STATUS[ai.code];
    params = ai.params && Object.fromEntries(Object.entries(ai.params).map(([k, v]) => [k, String(v)]));
  }
  return Response.json({ code, message: actionErrorMessage(code, params) }, { status, headers: NO_STORE });
}
