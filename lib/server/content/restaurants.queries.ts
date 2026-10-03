import 'server-only';
import { query } from '@/db/client';
import { fold } from '@/lib/booking';
import type { Highlight, Media, RestaurantDetail } from '@/lib/content/types';
import { MEALS, type Meal, type Restaurant } from '@/lib/data';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/* Restaurants as the guest site shows them, uncached (lib/server/content/restaurants.ts wraps them). */

type RestaurantRow = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  type_default: string | null;
  destination_id: string;
  destination_name: string | null;
  destination_name_default: string | null;
  cuisines: string[];
  cuisine_labels: string[];
  cuisine_labels_default: string[];
  meals: string[];
  booking_enabled: boolean;
  has_detail_page: boolean;
  image: Media | null;
  phone_e164: string | null;
  phone_display: string | null;
};

/**
 * The catalogue in the order staff set (ties broken by id, so the order is
 * total: phase-4 ledger T3), published and not archived. type: the
 * restaurant's type line in `locale`, else the default language's. cuisines:
 * restaurant_cuisines ids (slugs) of published cuisines, in their own order.
 * meals: the meals of the active service periods, in MEALS order (spec §6.3
 * item 2). phone: the restaurant's own number, else its destination's (spec
 * §6.4). search: name, type, cuisine labels and destination name, in `locale`
 * and in the default language, folded once here (spec §6.3 item 9). The
 * booking path reads lib/server/booking/rules.ts, never this.
 */
export async function loadRestaurants(locale: string): Promise<Restaurant[]> {
  const rows = await query<RestaurantRow>(
    `WITH ${LOCALE_CTE}
     SELECT r.id, r.slug, r.name, ${tr('rt', 'type_label')} AS type, rt_d.type_label AS type_default,
            r.destination_id, ${tr('dt', 'name')} AS destination_name, dt_d.name AS destination_name_default,
            r.booking_enabled, r.has_detail_page, img.j AS image,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_e164 ELSE d.phone_e164 END AS phone_e164,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_display ELSE d.phone_display END AS phone_display,
            ARRAY(SELECT rc.cuisine_id
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                   WHERE rc.restaurant_id = r.id
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisines,
            ARRAY(SELECT ${tr('ct', 'label')}
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                    ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
                   WHERE rc.restaurant_id = r.id AND ${tr('ct', 'label')} IS NOT NULL
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisine_labels,
            ARRAY(SELECT ct_d.label
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                    JOIN cuisine_i18n ct_d ON ct_d.cuisine_id = c.id AND ct_d.locale = lc.def
                   WHERE rc.restaurant_id = r.id
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisine_labels_default,
            ARRAY(SELECT m.meal
                    FROM unnest($2::text[]) WITH ORDINALITY AS m(meal, n)
                   WHERE EXISTS (SELECT 1 FROM service_periods p
                                  WHERE p.restaurant_id = r.id AND p.active AND p.meal = m.meal)
                   ORDER BY m.n) AS meals
       FROM restaurants r CROSS JOIN lc
       JOIN destinations d ON d.id = r.destination_id
       ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
       LEFT JOIN LATERAL ${mediaJson('r.card_image_id')} AS img ON true
      WHERE r.is_published AND r.archived_at IS NULL
      ORDER BY r.sort_order, r.id`,
    [locale, MEALS],
  );
  return rows.map((r) => {
    // What the card says, in the order the search overlay joined it before phase 6; then the default
    // language's words where they differ, so a guest can search in either (in English nothing is added).
    const shown = [r.name, r.type, ...r.cuisine_labels, r.destination_name];
    const fallback = [r.type_default, ...r.cuisine_labels_default, r.destination_name_default].filter((w) => !shown.includes(w));
    return {
      id: r.id,
      slug: r.slug,
      hasDetailPage: r.has_detail_page,
      name: r.name,
      type: r.type ?? '',
      cuisines: r.cuisines,
      dest: r.destination_id,
      meals: r.meals as Meal[],
      bookingEnabled: r.booking_enabled,
      image: r.image,
      phone: r.phone_e164 && r.phone_display ? { tel: r.phone_e164, display: r.phone_display } : null,
      search: fold([...shown, ...fallback].filter(Boolean).join(' ')),
    };
  });
}

/** Slugs with a page (generateStaticParams); unpublished or archived restaurants have none. */
export async function loadDetailSlugs(): Promise<string[]> {
  const rows = await query<{ slug: string }>(
    `SELECT slug FROM restaurants
      WHERE has_detail_page AND is_published AND archived_at IS NULL
      ORDER BY sort_order, id`,
  );
  return rows.map((r) => r.slug);
}

type DetailRow = {
  id: string;
  slug: string;
  name: string;
  destination_name: string | null;
  kicker: string | null;
  story_label: string | null;
  story: string | null;
  highlights_title: string | null;
  menu_pdf: string | null;
  seo_title: string | null;
  seo_description: string | null;
  booking_enabled: boolean;
  phone_e164: string | null;
  phone_display: string | null;
  map_url: string | null;
  portrait: Media | null;
};

/**
 * One restaurant's page, or null when it has none (no such slug, page off,
 * unpublished, archived, or its portrait gone). CALL and MAP take the
 * restaurant's own number and map, else its destination's (spec §6.4). MENU
 * opens the PDF of this language, else the default language's (an uploaded
 * file before a link), else scrolls to the highlights; with neither, no MENU.
 */
export async function loadRestaurantDetail(slug: string, locale: string): Promise<RestaurantDetail | null> {
  const [row] = await query<DetailRow>(
    `WITH ${LOCALE_CTE}
     SELECT r.id, r.slug, r.name, ${tr('dt', 'name')} AS destination_name,
            ${tr('rt', 'detail_kicker')} AS kicker, ${tr('rt', 'story_label')} AS story_label,
            ${tr('rt', 'story')} AS story, ${tr('rt', 'highlights_title')} AS highlights_title,
            coalesce((SELECT m.url FROM media m WHERE m.id = rt.menu_pdf_media_id AND m.deleted_at IS NULL), rt.menu_pdf_url,
                     (SELECT m.url FROM media m WHERE m.id = rt_d.menu_pdf_media_id AND m.deleted_at IS NULL), rt_d.menu_pdf_url) AS menu_pdf,
            ${tr('rt', 'seo_title')} AS seo_title, ${tr('rt', 'seo_description')} AS seo_description,
            r.booking_enabled,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_e164 ELSE d.phone_e164 END AS phone_e164,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_display ELSE d.phone_display END AS phone_display,
            coalesce(r.map_url, d.map_url) AS map_url,
            img.j AS portrait
       FROM restaurants r CROSS JOIN lc
       JOIN destinations d ON d.id = r.destination_id
       ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
       LEFT JOIN LATERAL ${mediaJson('r.detail_image_id')} AS img ON true
      WHERE r.slug = $2 AND r.has_detail_page AND r.is_published AND r.archived_at IS NULL`,
    [locale, slug],
  );
  if (!row || !row.portrait) return null;

  const highlights = await query<{ id: string; title: string; detail: string | null; image: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT h.id::text, ${tr('ht', 'title')} AS title, ${tr('ht', 'detail')} AS detail, img.j AS image
       FROM restaurant_highlights h CROSS JOIN lc
       ${i18nJoin('restaurant_highlight_i18n', 'ht', 'highlight_id', 'h.id')}
       LEFT JOIN LATERAL ${mediaJson('h.image_id')} AS img ON true
      WHERE h.restaurant_id = $2 AND h.is_published AND ${tr('ht', 'title')} IS NOT NULL
      ORDER BY h.sort_order, h.id`,
    [locale, row.id],
  );
  // A highlight whose picture was soft-deleted has nothing to show.
  const cards = highlights.flatMap((h): Highlight[] =>
    h.image ? [{ id: Number(h.id), title: h.title, detail: h.detail ?? '', image: h.image }] : [],
  );

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    destinationName: row.destination_name ?? '',
    kicker: row.kicker,
    storyLabel: row.story_label,
    story: row.story,
    highlightsTitle: row.highlights_title,
    portrait: row.portrait,
    bookingEnabled: row.booking_enabled,
    phone: row.phone_e164 && row.phone_display ? { tel: row.phone_e164, display: row.phone_display } : null,
    map: row.map_url,
    menu: row.menu_pdf ? { kind: 'pdf', url: row.menu_pdf } : cards.length > 0 ? { kind: 'scroll' } : null,
    highlights: cards,
    seo: { title: row.seo_title, description: row.seo_description },
  };
}
