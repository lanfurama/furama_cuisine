import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
