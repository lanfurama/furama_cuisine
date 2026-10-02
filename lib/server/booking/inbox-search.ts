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
 * working; a second tab's search replaces the cookie, and the first tab then
 * says its search has expired instead of showing the other tab's results.
 */

export const INBOX_SEARCH_COOKIE = 'fc_inbox_search';
/** Long enough to work through results, short enough not to linger on a shared PC. */
export const INBOX_SEARCH_MAX_AGE = 30 * 60;
const ID = /^[0-9a-f]{8}$/;

export type SavedSearch = { id: string; q: string };

/** What staff typed, as listInbox reads it (parseSearch keeps 100 characters). Null when there is nothing to search. */
export function searchText(raw: FormDataEntryValue | null): string | null {
  const q = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  return q.length >= 2 ? q : null;
}

export function encodeSearch(search: SavedSearch): string {
  return JSON.stringify([search.id, search.q]);
}

/**
 * The search the URL's id points at: `{ q }` when the cookie holds that id,
 * 'expired' when it does not (another search replaced it, or 30 minutes
 * passed), null when the URL names no search.
 */
export function decodeSearch(id: string | undefined, cookie: string | undefined): { q: string } | 'expired' | null {
  if (id === undefined) return null;
  if (!ID.test(id) || !cookie) return 'expired';
  try {
    const value: unknown = JSON.parse(cookie);
    if (Array.isArray(value) && value.length === 2 && value[0] === id && typeof value[1] === 'string') {
      const q = searchText(value[1]);
      if (q) return { q };
    }
  } catch {
    // A cookie this code did not write: same as none.
  }
  return 'expired';
}

/** Stores `q` and returns the id the URL carries. Server Actions only (cookies().set). */
export async function saveInboxSearch(q: string): Promise<string> {
  const id = randomBytes(4).toString('hex');
  (await cookies()).set(INBOX_SEARCH_COOKIE, encodeSearch({ id, q }), {
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
