import 'server-only';
import { query } from '@/db/client';
import { storyKicker } from '@/lib/content/format';
import type { Experience, HeroSlide, Media, Story } from '@/lib/content/types';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/* The home page's lists, uncached (lib/server/content/home.ts wraps them). Published rows, by sort_order then id. */

export async function loadHeroSlides(locale: string): Promise<HeroSlide[]> {
  const rows = await query<{ id: string; image: Media | null; mobile: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT h.id::text, img.j AS image, mob.j AS mobile
       FROM hero_slides h CROSS JOIN lc
       LEFT JOIN LATERAL ${mediaJson('h.image_id')} AS img ON true
       LEFT JOIN LATERAL ${mediaJson('h.image_mobile_id')} AS mob ON true
      WHERE h.is_published
      ORDER BY h.sort_order, h.id`,
    [locale],
  );
  // A slide whose picture was soft-deleted has nothing to show.
  return rows.flatMap((r) => (r.image ? [{ id: Number(r.id), image: r.image, mobile: r.mobile }] : []));
}

export async function loadExperiences(locale: string): Promise<Experience[]> {
  const rows = await query<{ id: string; title: string; blurb: string | null; link_url: string | null }>(
    `WITH ${LOCALE_CTE}
     SELECT e.id::text, ${tr('et', 'title')} AS title, ${tr('et', 'blurb')} AS blurb, e.link_url
       FROM experiences e CROSS JOIN lc
       ${i18nJoin('experience_i18n', 'et', 'experience_id', 'e.id')}
      WHERE e.is_published AND ${tr('et', 'title')} IS NOT NULL
      ORDER BY e.sort_order, e.id`,
    [locale],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, blurb: r.blurb ?? '', href: r.link_url }));
}

/** The kicker is formatted here, on the server (spec §14.1 row 6: "9 Sep 2026", never the browser's ICU). */
export async function loadStories(locale: string): Promise<Story[]> {
  const rows = await query<{
    id: string;
    category: string | null;
    title: string;
    href: string;
    published_on: string | null;
    image: Media | null;
  }>(
    `WITH ${LOCALE_CTE}
     SELECT s.id::text, ${tr('st', 'category')} AS category, ${tr('st', 'title')} AS title,
            coalesce(st.href, s.href) AS href, to_char(s.published_on, 'YYYY-MM-DD') AS published_on, img.j AS image
       FROM stories s CROSS JOIN lc
       ${i18nJoin('story_i18n', 'st', 'story_id', 's.id')}
       LEFT JOIN LATERAL ${mediaJson('s.image_id')} AS img ON true
      WHERE s.is_published AND ${tr('st', 'title')} IS NOT NULL
      ORDER BY s.sort_order, s.id`,
    [locale],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    image: r.image,
    kicker: storyKicker(r.category ?? '', r.published_on, locale),
    title: r.title,
    href: r.href,
  }));
}
