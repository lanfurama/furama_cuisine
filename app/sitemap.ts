import type { MetadataRoute } from 'next';
import { getEnabledLocales } from '@/lib/server/content/locales';
import { getDetailSlugs } from '@/lib/server/content/restaurants';
import { siteOrigin } from '@/lib/site-origin';

/*
 * Every guest page in every enabled language, each with its hreflang
 * alternates (spec §6.1, §8 step 4; L8-7). Both reads are cached and tagged
 * (locales; restaurants, content:destinations, media), so enabling a language
 * or opening a restaurant page puts it here without a deploy. Never a disabled
 * language (Draft Mode previews it unlisted, spec §6.1).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const [languages, slugs] = await Promise.all([getEnabledLocales(), getDetailSlugs()]);
  const paths = ['', '/privacy', ...slugs.map((slug) => `/restaurants/${slug}`)];
  return paths.flatMap((path) => {
    const alternates = {
      languages: Object.fromEntries(languages.map((l) => [l.bcp47, new URL(`/${l.code}${path}`, origin).href])),
    };
    return languages.map((l) => ({ url: new URL(`/${l.code}${path}`, origin).href, alternates }));
  });
}
