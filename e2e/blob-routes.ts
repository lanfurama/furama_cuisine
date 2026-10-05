import type { BrowserContext } from '@playwright/test';

/*
 * The browser's half of the fake Vercel Blob (playwright.config.ts starts the
 * fake and hands the app server its token; test/helpers/fake-blob.ts). The
 * media library's browser PUTs uploads straight to https://vercel.com/api/blob
 * (spec §11, R17) and could read files from the store's public host: both are
 * forwarded to the fake here, and every other host outside localhost is
 * aborted and recorded, so a test fails instead of reaching the internet.
 */

export const FAKE_BLOB = process.env.FAKE_BLOB_ORIGIN ?? '';

/**
 * Holds the browser's upload PUTs for `ms` (0: none) before they reach the
 * fake. Opt-in, and changeable mid-test: a spec sets `ms` just before the
 * upload it needs to stay in flight (an edit typed during an upload).
 */
export type SlowPut = { ms: number };

/** Forwards the Blob hosts to the fake for every page of `context`; pushes any other external request to `outside`. */
export async function routeBlobToFake(context: BrowserContext, outside: string[], slowPut?: SlowPut): Promise<void> {
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.fallback();
    if (slowPut?.ms && route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, slowPut.ms));
    let target: string | null = null;
    if (url.hostname === 'vercel.com' && url.pathname.startsWith('/api/blob')) target = `${FAKE_BLOB}${url.pathname}${url.search}`;
    if (url.hostname.endsWith('.public.blob.vercel-storage.com')) target = `${FAKE_BLOB}/cdn${url.pathname}${url.search}`;
    if (!target) {
      outside.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    // Playwright answers the CORS preflight of an intercepted request itself.
    return route.fulfill({ response: await route.fetch({ url: target }) });
  });
}

/** What the fake store holds now. */
export async function fakeBlobFiles(): Promise<{ pathname: string }[]> {
  return (await fetch(`${FAKE_BLOB}/__fake/files`)).json();
}
