/*
 * Response headers for every /admin page (spec §11). proxy.ts builds them per
 * request: the nonce must be new for each response, which is why the admin
 * renders at request time (app/admin/layout.tsx) and the guest site, which is
 * prerendered, never gets this policy.
 *
 * Next.js reads the nonce back from the Content-Security-Policy *request*
 * header and puts it on its own <script> tags
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:179-193;
 * node_modules/next/dist/server/app-render/app-render.js:209-210 takes it from
 * script-src, else default-src).
 */

/** 128 random bits, base64. Next only accepts [A-Za-z0-9+/_-] and '=' padding. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export type CspOptions = {
  /** `next dev`: React needs eval for its error overlay; the dev overlay injects <style> tags. */
  dev: boolean;
  /** Only an https origin may tell the browser to upgrade subresources (it would break http://localhost). */
  https: boolean;
};

/**
 * Where the media library's browser PUTs an upload (spec §11, uploadPresigned):
 * the Blob API, https://vercel.com/api/blob unless NEXT_PUBLIC_VERCEL_BLOB_API_URL
 * moves it (node_modules/@vercel/blob/dist/chunk-YYMLUMXS.js getApiUrl). A CSP
 * source with a trailing slash matches that path and everything under it.
 */
export function blobApiSource(env: Record<string, string | undefined> = process.env): string {
  const base = env.NEXT_PUBLIC_VERCEL_BLOB_API_URL?.trim() || 'https://vercel.com/api/blob';
  return `${base.replace(/\/+$/, '')}/`;
}

export function adminContentSecurityPolicy(nonce: string, { dev, https }: CspOptions): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic': chunks that Next's nonced runtime loads are trusted too; 'self' is a CSP2 fallback.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Stylesheets are files (CSS modules, admin.css, next/font); no inline <style> and no style="" in admin markup.
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Thumbnails and previews of uploads go through /_next/image ('self'), never straight to the Blob host.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${blobApiSource()}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Every header an admin page response carries, the CSP included. */
export function adminSecurityHeaders(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    // Invite and reset links carry their token in the URL: never send it to another site.
    // (no-referrer would also do; Server Actions still get a real Origin under it in Chromium.)
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
