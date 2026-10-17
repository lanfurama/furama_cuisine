/*
 * The writing assistant's limit on its input (R9-10), shared by the route
 * (lib/server/ai/assist.ts refuses beyond it) and the panel, which says so
 * before calling instead of showing the generic "invalid" message.
 */
export const MAX_ASSIST_CHARS = 4000;

export const ASSIST_TOO_LONG = 'Đoạn văn quá dài cho trợ lý (tối đa 4.000 ký tự).';

/** Why the panel will not send this text, or null. Counted like the route's zod check (UTF-16 length). */
export function assistRefusal(text: string): string | null {
  return text.length > MAX_ASSIST_CHARS ? ASSIST_TOO_LONG : null;
}
