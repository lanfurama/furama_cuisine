import 'server-only';
import { query } from '@/db/client';
import {
  SECTION_KEYS,
  type Cuisine,
  type Destination,
  type Media,
  type NavItem,
  type SectionKey,
  type Sections,
  type SocialLink,
} from '@/lib/content/types';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/*
 * The site-wide content (the chrome of every guest page), uncached: the
 * 'use cache' wrappers live in lib/server/content/site.ts. One query each, so
 * each wrapper carries exactly the tags of the tables it read
 * (lib/cache-plan.ts LOADERS). Unpublished rows never leave the database;
 * lists are ordered by sort_order, then id.
 */

/** Every section, keyed; a key without a row is visible with nothing attached (a section added in code before its row). */
export async function loadSections(locale: string): Promise<Sections> {
  const rows = await query<{ key: SectionKey; is_visible: boolean; link_url: string | null; image: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT s.key, s.is_visible, s.link_url, img.j AS image
       FROM sections s CROSS JOIN lc
       LEFT JOIN LATERAL ${mediaJson('s.image_id')} AS img ON true`,
    [locale],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(
    SECTION_KEYS.map((key) => {
      const r = byKey.get(key);
      return [key, { visible: r?.is_visible ?? true, image: r?.image ?? null, link: r?.link_url ?? null }];
    }),
  ) as Sections;
}

export async function loadCuisines(locale: string): Promise<Cuisine[]> {
  return query<Cuisine>(
    `WITH ${LOCALE_CTE}
     SELECT c.id, ${tr('ct', 'label')} AS label, img.j AS image
       FROM cuisines c CROSS JOIN lc
       ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
       LEFT JOIN LATERAL ${mediaJson('c.image_id')} AS img ON true
      WHERE c.is_published AND ${tr('ct', 'label')} IS NOT NULL
      ORDER BY c.sort_order, c.id`,
    [locale],
  );
}

type DestinationRow = {
  id: string;
  kind: 'venue' | 'teaser';
  name: string | null;
  title_1: string | null;
  title_2: string | null;
  blurb_1: string | null;
  blurb_2: string | null;
  address: string | null;
  phone_e164: string | null;
  phone_display: string | null;
  map_url: string | null;
  show_in_footer: boolean;
  image: Media | null;
};

/** The published destinations; a teaser may have no name (its card says it all). */
export async function loadDestinations(locale: string): Promise<Destination[]> {
  const rows = await query<DestinationRow>(
    `WITH ${LOCALE_CTE}
     SELECT d.id, d.kind, ${tr('dt', 'name')} AS name,
            ${tr('dt', 'card_title_1')} AS title_1, ${tr('dt', 'card_title_2')} AS title_2,
            ${tr('dt', 'card_blurb_1')} AS blurb_1, ${tr('dt', 'card_blurb_2')} AS blurb_2,
            ${tr('dt', 'address')} AS address,
            d.phone_e164, d.phone_display, d.map_url, d.show_in_footer, img.j AS image
       FROM destinations d CROSS JOIN lc
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
       LEFT JOIN LATERAL ${mediaJson('d.card_image_id')} AS img ON true
      WHERE d.is_published
      ORDER BY d.sort_order, d.id`,
    [locale],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    cardTitle: [r.title_1 ?? r.name ?? '', r.title_2 ?? ''],
    cardBlurb: [r.blurb_1 ?? '', r.blurb_2 ?? ''],
    image: r.image,
    address: r.address,
    phone: r.phone_e164 && r.phone_display ? { tel: r.phone_e164, display: r.phone_display } : null,
    map: r.map_url,
    showInFooter: r.show_in_footer,
  }));
}

/** The header and menu links; an item whose section is switched off is left out (spec §6.5). */
export async function loadNav(locale: string): Promise<NavItem[]> {
  return query<NavItem>(
    `WITH ${LOCALE_CTE}
     SELECT n.target_section AS target, ${tr('nt', 'label')} AS label
       FROM nav_items n CROSS JOIN lc
       JOIN sections s ON s.key = n.target_section AND s.is_visible
       ${i18nJoin('nav_item_i18n', 'nt', 'nav_item_id', 'n.id')}
      WHERE n.is_published AND ${tr('nt', 'label')} IS NOT NULL
      ORDER BY n.sort_order, n.id`,
    [locale],
  );
}

/** The footer's social links shown in `locale` (visible_locales NULL: every language). */
export async function loadSocials(locale: string): Promise<SocialLink[]> {
  return query<SocialLink>(
    `SELECT platform, href FROM social_links
      WHERE is_published AND (visible_locales IS NULL OR $1 = ANY (visible_locales))
      ORDER BY sort_order, id`,
    [locale],
  );
}
