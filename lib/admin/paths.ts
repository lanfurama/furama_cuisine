/*
 * Admin URLs shared by proxy.ts (no server-only imports) and the sign-in action.
 */

export const ADMIN_HOME = '/admin';
export const ADMIN_SIGN_IN = '/admin/sign-in';

/** The only admin pages reachable without a session cookie (spec §6.1). */
export const PUBLIC_ADMIN_PATHS: readonly string[] = [ADMIN_SIGN_IN, '/admin/accept-invite', '/admin/reset-password'];

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.includes(pathname);
}

/**
 * Where to go after signing in. Only a path inside the admin is accepted, so
 * `?next=` cannot send a fresh session to another site (//evil.example,
 * https://…, /\evil) or loop back to a public page. Anything else → /admin.
 */
export function safeAdminNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return ADMIN_HOME;
  }
  const base = 'http://admin.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return ADMIN_HOME;
  }
  if (url.origin !== base || !isAdminPath(url.pathname) || isPublicAdminPath(url.pathname)) return ADMIN_HOME;
  url.searchParams.delete('_rsc');
  return `${url.pathname}${url.search}`;
}
