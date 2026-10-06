/**
 * The public origin for absolute URLs: canonical and hreflang links
 * (metadataBase), the sitemap and robots.txt (R8-9). SITE_URL when the
 * production domain is known; else the one Vercel gives the project's
 * production deployment, so a Preview's canonical still points at production
 * and Google never indexes a preview; else this machine. Pure: the env is an
 * argument for the tests.
 */
export function siteOrigin(env: Record<string, string | undefined> = process.env): URL {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return new URL(new URL(explicit).origin);
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return new URL(`https://${vercel}`);
  return new URL('http://localhost:3000');
}
