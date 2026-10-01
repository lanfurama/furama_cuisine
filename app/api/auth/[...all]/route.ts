import { getAuth } from '@/lib/server/auth/auth';
import { ADMIN_ENDPOINT_BLOCKED } from '@/lib/server/auth/config';

/*
 * Better Auth's HTTP endpoints. The admin plugin's /admin/* endpoints are
 * server-only (spec §7.1): hooks.before in lib/server/auth/config.ts refuses
 * them, and so does this check, which does not rely on Better Auth internals.
 * getAuth() is lazy, so `next build` needs no auth variables.
 */
async function handle(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/api/auth/admin/')) {
    return Response.json({ code: ADMIN_ENDPOINT_BLOCKED }, { status: 403 });
  }
  return getAuth().handler(request);
}

export { handle as GET, handle as POST };
