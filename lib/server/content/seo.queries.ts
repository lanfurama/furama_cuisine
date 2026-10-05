import 'server-only';
import { query } from '@/db/client';
import type { Media } from '@/lib/content/types';
import { LOCALE_CTE, mediaJson } from './sql';

/*
 * The SEO screen's share picture (site_settings.og_image_id, spec §7.2
 * content/seo), uncached: the 'use cache' wrapper is lib/server/content/seo.ts.
 * Its alt in `locale` (og:image:alt), else the default language's; null when
 * none is chosen or its file left the library.
 */
export async function loadShareImage(locale: string): Promise<Media | null> {
  const rows = await query<{ image: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT img.j AS image
       FROM site_settings s CROSS JOIN lc
       LEFT JOIN LATERAL ${mediaJson('s.og_image_id')} AS img ON true
      WHERE s.id`,
    [locale],
  );
  return rows[0]?.image ?? null;
}
