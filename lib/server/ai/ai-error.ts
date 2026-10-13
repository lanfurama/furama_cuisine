import 'server-only';

/* The error type of the AI guard, apart from errors.ts so action-result.ts can import it without pulling in the AI SDK. */
export type AiErrorCode =
  | 'ai_off'
  | 'ai_budget'
  | 'ai_rate_minute'
  | 'ai_rate_day'
  | 'ai_auth'
  | 'ai_not_found'
  | 'ai_quota'
  | 'ai_bad_request'
  | 'ai_failed'
  | 'ai_placeholder'
  | 'ai_preview';

/** A refusal or failure of an AI call; `params` carries the numbers the message names (the limit, the budget). */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = 'AiError';
  }
}
