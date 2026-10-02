import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // BotID's two halves decide by this one value (lib/botid.ts botIdEnabled, lib/server/guard/bot.ts).
  // Next inlines a NEXT_PUBLIC_* variable only when it exists at build time; a build without it (say
  // `vercel deploy --prebuilt` from a machine without Vercel's system variables) would leave the
  // server reading the runtime value while browsers never got BotID, and every booking would be
  // refused as a bot. Set here, it is always inlined into the browser and server bundles alike
  // (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/env.md:23),
  // empty when absent; scripts/check-prerender.mjs fails a build where it was not.
  env: { NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV ?? '' },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // app/global-not-found.tsx: there is no app/layout.tsx to hold a 404 for unmatched URLs.
    globalNotFound: true,
    // forbidden() for admin pages a role may not open (lib/server/dal/session.ts, app/admin/(shell)/forbidden.tsx).
    authInterrupts: true,
  },
  async redirects() {
    return [
      // The detail page moved under the locale prefix in phase 2 (308, query kept).
      { source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true },
    ];
  },
};

// BotID (spec §10.2 step 1): rewrites its challenge script and API under
// /149e9513-01fa-4fb0-aad4-566afd725d1b/… to Vercel. Requested only where
// instrumentation-client.ts installs BotID, i.e. on a Vercel deployment.
export default withBotId(nextConfig);
