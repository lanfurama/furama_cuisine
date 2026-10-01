import { join, normalize, sep } from 'node:path';
import type { Page } from '@playwright/test';

const PUBLIC_DIR = join(__dirname, '..', 'public');

/**
 * Answers every /_next/image request with the original file from public/, so
 * the page's load event and networkidle no longer depend on next start's image
 * optimizer. For specs that check markup or hydration, not images.
 *
 * Next 16.3's optimizer fetches a source image it has not cached yet through a
 * mocked response that holds the requesting browser's socket. If that browser
 * disconnects mid-fetch (another test closing its page while images below the
 * fold load, on a fresh server), the fetch never settles, and every later
 * request for the same image, width and format waits on it until the server
 * restarts. A page with JavaScript off loads every image at once and a
 * networkidle wait covers the lazy ones too, so those specs timed out at random.
 * Fixed upstream for 16.4: fetchInternalImage in 16.4.0-canary.54 keeps the
 * socket off the mocked response (16.3.8 still has the bug); drop this once
 * the app is on a release with that fix. Vercel serves /_next/image itself,
 * so the deployed site never runs that code.
 */
export async function serveImagesFromPublic(page: Page) {
  await page.route(
    (url) => url.pathname === '/_next/image',
    (route) => {
      const src = new URL(route.request().url()).searchParams.get('url') ?? '';
      const file = normalize(join(PUBLIC_DIR, src));
      if (!src.startsWith('/') || !file.startsWith(PUBLIC_DIR + sep)) return route.fallback();
      return route.fulfill({ path: file });
    },
  );
}
