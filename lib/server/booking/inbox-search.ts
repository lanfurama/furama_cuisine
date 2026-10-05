import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

/*
 * The inbox search box without the guest in the URL (phase-4 ruling SEC-2).
 * A search is a phone number, a name or an email; in a GET query string it
 * would sit in Vercel's request logs, the browser history and the sign-in
 * page's `next` link. So the box POSTs to searchReservations, which keeps the
 * text in a short-lived httpOnly cookie under a random id, and the page URL
 * carries only that id (?tim=…). Tabs, keyset paging (?sau=) and reload keep
 * working. The cookie keeps the last five searches (phase-5 ledger, admin
 * F5): Back from a second search to the first, or a second tab's search,
 * still finds its results; a sixth search pushes the oldest out, and a page
 * still pointing at it says its search has expired, never another one's.
 * Browsers drop a cookie over 4 KB, and the value is stored percent-encoded
 * (a Vietnamese letter takes 9 bytes), so five long Vietnamese names would
 * not fit: older searches also drop out once the cookie would pass
 * COOKIE_BUDGET. The newest search always stays (100 characters at most).
 */

export const INBOX_SEARCH_COOKIE = 'fc_inbox_search';
/** Long enough to work through results, short enough not to linger on a shared PC. */
export const INBOX_SEARCH_MAX_AGE = 30 * 60;
const ID = /^[0-9a-f]{8}$/;
/** How many searches the cookie keeps, newest first. */
export const INBOX_SEARCHES_KEPT = 5;
/** Bytes of the stored (percent-encoded) value, under the 4096 a browser keeps for name, value and attributes. */
export const COOKIE_BUDGET = 3500;

export type SavedSearch = { id: string; q: string };

/** What staff typed, as listInbox reads it (parseSearch keeps 100 characters). Null when there is nothing to search. */
export function searchText(raw: FormDataEntryValue | null): string | null {
  const q = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  return q.length >= 2 ? q : null;
}

/** The kept searches, newest first, as the cookie holds them: [[id, q], …]. */
export function encodeSearches(searches: readonly SavedSearch[]): string {
  return JSON.stringify(searches.slice(0, INBOX_SEARCHES_KEPT).map((s) => [s.id, s.q]));
}

/** The searches a cookie holds, newest first; nothing for a cookie this code did not write. */
export function readSearches(cookie: string | undefined): SavedSearch[] {
  if (!cookie) return [];
  try {
    const value: unknown = JSON.parse(cookie);
    if (!Array.isArray(value)) return [];
    return value.flatMap((pair: unknown) =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && ID.test(pair[0]) && typeof pair[1] === 'string' ? [{ id: pair[0], q: pair[1] }] : [],
    );
  } catch {
    return [];
  }
}

/** The cookie after a new search: it goes first, and the oldest drop out beyond five or past the budget. */
export function rememberSearch(cookie: string | undefined, search: SavedSearch): string {
  const kept = [search, ...readSearches(cookie).filter((s) => s.id !== search.id)].slice(0, INBOX_SEARCHES_KEPT);
  while (kept.length > 1 && encodeURIComponent(encodeSearches(kept)).length > COOKIE_BUDGET) kept.pop();
  return encodeSearches(kept);
}

/**
 * The search the URL's id points at: `{ q }` when the cookie holds that id,
 * 'expired' when it does not (five newer searches pushed it out, or 30
 * minutes passed), null when the URL names no search.
 */
export function decodeSearch(id: string | undefined, cookie: string | undefined): { q: string } | 'expired' | null {
  if (id === undefined) return null;
  if (!ID.test(id)) return 'expired';
  const found = readSearches(cookie).find((s) => s.id === id);
  const q = found ? searchText(found.q) : null;
  return q ? { q } : 'expired';
}

/** Stores `q` and returns the id the URL carries. Server Actions only (cookies().set). */
export async function saveInboxSearch(q: string): Promise<string> {
  const id = randomBytes(4).toString('hex');
  const jar = await cookies();
  jar.set(INBOX_SEARCH_COOKIE, rememberSearch(jar.get(INBOX_SEARCH_COOKIE)?.value, { id, q }), {
    httpOnly: true,
    sameSite: 'strict',
    // Plain http only where the app itself runs on it (local, E2E).
    secure: !(process.env.BETTER_AUTH_URL ?? '').startsWith('http://'),
    path: '/admin/reservations',
    maxAge: INBOX_SEARCH_MAX_AGE,
  });
  return id;
}

export async function readInboxSearch(id: string | undefined): Promise<{ q: string } | 'expired' | null> {
  return decodeSearch(id, (await cookies()).get(INBOX_SEARCH_COOKIE)?.value);
}
