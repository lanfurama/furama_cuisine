/*
 * Vercel BotID, browser half (spec §10.2 step 1). instrumentation-client.ts
 * calls initBotId with this list before hydration; BotID then wraps
 * window.fetch, and every same-origin request matching an entry waits for a
 * challenge answer and carries it as x-is-human. submitReservation's
 * checkBotId (lib/server/guard/bot.ts) sends that answer to Vercel.
 *
 * A Server Action is not a route of its own: the browser POSTs it to the URL
 * of the page it runs on (proxy.md:249), and Next's action client calls the
 * global fetch at that moment (next/dist/client/components/segment-cache/
 * fetch.js:28), so the wrapper sees it. The drawer opens on every guest page
 * in every language, so the entry is every POST; the guest site sends no
 * other POST. Admin pages never install BotID (botIdEnabled), so their
 * actions are untouched.
 */
export const BOTID_PROTECT = [{ path: '/*', method: 'POST' }];

/**
 * VERCEL_ENV of a Vercel deployment, and NEXT_PUBLIC_VERCEL_ENV, its copy that `next build` inlines.
 * `vercel dev` and `vercel env pull` say 'development': not one. The server half
 * (lib/server/guard/bot.ts) decides by the same set.
 */
export const DEPLOYED: ReadonlySet<string> = new Set(['production', 'preview']);

/**
 * Only a Vercel deployment can answer BotID's challenge (its script is a
 * rewrite to Vercel added by withBotId in next.config.ts), and only guest
 * pages book. Off Vercel the wrapper would wait on a script that never loads
 * and the booking would fail, so local, CI and E2E runs leave fetch alone.
 */
export function botIdEnabled(vercelEnv: string | undefined, pathname: string): boolean {
  return DEPLOYED.has(vercelEnv ?? '') && pathname !== '/admin' && !pathname.startsWith('/admin/');
}
