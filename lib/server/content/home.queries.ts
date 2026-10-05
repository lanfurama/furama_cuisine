import 'server-only';
import { query } from '@/db/client';
import { formatPrice, offerDetail, storyKicker, type PriceTemplates } from '@/lib/content/format';
import { resolveStrings } from '@/lib/i18n/resolve';
import type { Experience, HeroSlide, Media, Offer, Story } from '@/lib/content/types';
import { LOCALE_CTE, VENUE_TODAY, i18nJoin, mediaJson, tr } from './sql';
import { loadStringRows } from './strings.queries';

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

/**
 * The offers on show today in Da Nang (spec §5.2, §6.2): published, their
 * restaurant published and not archived, and today between valid_from and
 * valid_until (both days included; either may be open). Only the date makes
 * this list change by itself: its cached wrapper lives for hours, and the
 * daily cron revalidates content:offers. The detail line is formatted here,
 * on the server.
 */
const PRICE_KEYS = ['offers.price_plus_plus', 'offers.price_net'] as const;

export async function loadOffers(locale: string): Promise<Offer[]> {
  const rows = await query<{
    id: string;
    restaurant_id: string;
    venue: string;
    title: string;
    schedule: string | null;
    price_amount: string | null;
    currency: string;
    price_basis: 'plus_plus' | 'net' | null;
  }>(
    `WITH ${LOCALE_CTE}
     SELECT o.id::text, o.restaurant_id, coalesce(${tr('ot', 'venue_override')}, r.name) AS venue,
            ${tr('ot', 'title')} AS title, ${tr('ot', 'schedule')} AS schedule,
            o.price_amount::text AS price_amount, o.currency, o.price_basis
       FROM offers o CROSS JOIN lc
       JOIN restaurants r ON r.id = o.restaurant_id AND r.is_published AND r.archived_at IS NULL
       ${i18nJoin('offer_i18n', 'ot', 'offer_id', 'o.id')}
      WHERE o.is_published AND ${tr('ot', 'title')} IS NOT NULL
        AND (o.valid_from IS NULL OR o.valid_from <= ${VENUE_TODAY})
        AND (o.valid_until IS NULL OR o.valid_until >= ${VENUE_TODAY})
      ORDER BY o.sort_order, o.id`,
    [locale],
  );
  // The price wording is the offers screen's (offers.price_*): LOADERS.offers reads content_strings and carries content:ui.
  const { defaultLocale, rows: strings } = await loadStringRows(locale, PRICE_KEYS);
  const words = resolveStrings(strings, PRICE_KEYS, locale, defaultLocale);
  const templates: PriceTemplates = { plus_plus: words['offers.price_plus_plus'], net: words['offers.price_net'] };
  return rows.map((r) => ({
    id: Number(r.id),
    restaurantId: r.restaurant_id,
    venue: r.venue,
    title: r.title,
    detail: offerDetail(
      r.price_amount !== null && r.price_basis ? formatPrice({ amount: r.price_amount, currency: r.currency, basis: r.price_basis }, locale, templates) : null,
      r.schedule,
    ),
  }));
}
