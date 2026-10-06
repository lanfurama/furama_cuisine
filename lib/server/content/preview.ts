/*
 * Where /api/admin/preview may send a member of staff (spec §6.1, C6): a path
 * on this site whose first segment is a language in the table. Anything else
 * (another origin, a protocol-relative or backslashed path, an unknown first
 * segment, a long string) is refused, so the route is never an open redirect.
 * Pure: the codes are an argument.
 */
const MAX_LENGTH = 300;
const BASE = 'http://preview.invalid';

export function previewPath(raw: string | null | undefined, codes: readonly string[]): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const first = url.pathname.split('/')[1] ?? '';
  if (!codes.includes(first)) return null;
  return `${url.pathname}${url.search}`;
}
