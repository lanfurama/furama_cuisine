import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';

/*
 * robots.txt (L8-7): the guest site is open to crawlers; the admin and the
 * API are not. A Preview deployment is kept out of search engines by Vercel's
 * own X-Robots-Tag: noindex, so this file is the same everywhere.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api'] },
    sitemap: new URL('/sitemap.xml', siteOrigin()).href,
  };
}
