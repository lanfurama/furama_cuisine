import 'server-only';
import { APICallError, RetryError } from 'ai';
import { AiError, type AiErrorCode } from '@/lib/server/ai-error';
import { AiOffError } from './client';

export { AiError, type AiErrorCode };

function fromStatus(status: unknown): AiErrorCode {
  if (status === 401 || status === 403) return 'ai_auth';
  if (status === 404) return 'ai_not_found';
  if (status === 429) return 'ai_quota';
  if (status === 400) return 'ai_bad_request';
  return 'ai_failed';
}

/**
 * The code staff read for a failure (R9-15; spec §9.2, §12). Vertex's HTTP
 * status decides; the WIF token exchange fails inside google-auth-library with a
 * GaxiosError carrying `response.status`, read the same way. Timeouts, aborts,
 * an unparseable answer and anything unknown are ai_failed. Nothing of the
 * error's text is kept: it may quote the prompt.
 */
export function vertexErrorCode(err: unknown): AiErrorCode {
  if (err instanceof AiError) return err.code;
  if (err instanceof AiOffError) return 'ai_off';
  // maxRetries: 1 wraps the last failure in a RetryError; the status is on what it wraps.
  if (RetryError.isInstance(err)) return vertexErrorCode(err.lastError);
  if (APICallError.isInstance(err)) return fromStatus(err.statusCode);
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return status === undefined ? 'ai_failed' : fromStatus(status);
}
