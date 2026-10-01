import 'server-only';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { getAuth } from './auth';

/*
 * Sign-in and both reset steps are Server Actions (useActionState, spec §7.3)
 * that call Better Auth's HTTP router in process instead of auth.api.*: only
 * the router applies the rate limit stored in auth_rate_limit (spec §7.1) and
 * the origin check (better-auth/dist/api/index.mjs:172). nextCookies() does
 * nothing for router calls, so the action copies Set-Cookie itself.
 */

/** What reaches Better Auth from the visitor's request: its address (rate limit, session) and user agent. Never cookies. */
const FORWARDED = ['x-forwarded-for', 'x-real-ip', 'user-agent'] as const;

export async function callAuthEndpoint(path: `/${string}`, body: unknown): Promise<Response> {
  const incoming = await headers();
  const auth = getAuth();
  const { baseURL } = await auth.$context; // e.g. http://localhost:3200/api/auth
  const forwarded = new Headers({ 'content-type': 'application/json', origin: new URL(baseURL).origin });
  for (const name of FORWARDED) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  return auth.handler(new Request(`${baseURL}${path}`, { method: 'POST', headers: forwarded, body: JSON.stringify(body) }));
}

/** Puts every cookie Better Auth set on `res` onto the Server Action's own response. */
export async function applySetCookies(res: Response): Promise<void> {
  const jar = await cookies();
  for (const header of res.headers.getSetCookie()) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      jar.set(name, attributes.value, toCookieOptions(attributes));
    }
  }
}
