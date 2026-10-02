import { initBotId } from 'botid/client/core';
import { BOTID_PROTECT, botIdEnabled, installBotIdWithDeadline } from '@/lib/botid';

/*
 * Runs in every page's browser bundle, after the HTML loads and before
 * hydration (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * instrumentation-client.md:117-127), so BotID wraps fetch before the reserve
 * drawer can send anything. Synchronous on purpose: async work here is not
 * awaited (same file, :127). installBotIdWithDeadline gives BotID's challenge
 * 15 s, so a challenge script that fails or stalls cannot hold a booking for
 * ever (lib/botid.ts).
 */
if (botIdEnabled(process.env.NEXT_PUBLIC_VERCEL_ENV, window.location.pathname)) {
  installBotIdWithDeadline(() => initBotId({ protect: BOTID_PROTECT }));
}
