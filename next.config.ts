import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // app/global-not-found.tsx: there is no app/layout.tsx to hold a 404 for unmatched URLs.
    globalNotFound: true,
  },
  async redirects() {
    return [
      // The detail page moved under the locale prefix in phase 2 (308, query kept).
      { source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true },
    ];
  },
};

export default nextConfig;
