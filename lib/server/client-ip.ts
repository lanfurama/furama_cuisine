import { isIP } from 'node:net';

/*
 * The client's address for audit_log.ip and Better Auth's per-IP limits: the
 * first X-Forwarded-For entry. Vercel sets that header itself (the client's
 * address first), so it is trustworthy there; self-hosted, a proxy must do the
 * same (phase 3, risk 3). Only a real IPv4/IPv6 address comes back: Postgres
 * inet rejects anything else (an IPv6 zone id such as 'fe80::1%lo0' passes
 * isIP but not inet), and a rejected insert would roll back the action.
 */
export function clientIp(headers: Pick<Headers, 'get'>): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first || first.includes('%') || isIP(first) === 0) return null;
  return first;
}
