import 'server-only';
import type { Db } from '@/db/client';
import type { StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import type { SeoMaterial } from '@/lib/server/ai/seo';
import { LOCALE_CTE, i18nJoin, tr } from '@/lib/server/content/sql';
import { loadStringRows } from '@/lib/server/content/strings.queries';

/*
 * What a page says, for "Gợi ý bằng AI" on SEO (spec §9.3, R9-17, R9-22): the
 * CMS side reads it, so the gate (lib/server/ai/seo.ts) never reads a content
 * table and the route never takes text from the client. The text is what
 * guests read in `locale`: a reviewed translation, else the default
 * language's (lib/server/content/sql.ts), so a machine row is not quoted.
 * Content tables only: no reservation, no guest, nothing from booking or
 * email (spec §9.4; test/guards/ai-imports.guard.test.ts holds this file to it).
 * The labels are English: the model reads them, staff never do.
 */

export type SeoTarget = { kind: 'home' } | { kind: 'restaurant'; id: string };

const nonEmpty = (fields: { label: string; text: string | null | undefined }[]): SeoMaterial['fields'] =>
  fields.flatMap(({ label, text }) => (text && text.trim() ? [{ label, text: text.trim() }] : []));

/** The page's material, or null when the restaurant does not exist. */
export async function seoMaterial(db: Db, target: SeoTarget, locale: string): Promise<SeoMaterial | null> {
  return target.kind === 'home' ? homeMaterial(db, locale) : restaurantMaterial(db, target.id, locale);
}

type RestaurantRow = {
  name: string;
  type_label: string | null;
  kicker: string | null;
  story: string | null;
  seo_title: string | null;
  seo_description: string | null;
  destination_name: string | null;
  cuisines: string[];
};

/** Any restaurant the editor can open (archived or hidden ones too: their SEO is edited all the same). */
async function restaurantMaterial(db: Db, id: string, locale: string): Promise<SeoMaterial | null> {
  const { rows } = await db.query<RestaurantRow>(
    `WITH ${LOCALE_CTE}
     SELECT r.name, ${tr('rt', 'type_label')} AS type_label, ${tr('rt', 'detail_kicker')} AS kicker, ${tr('rt', 'story')} AS story,
            ${tr('rt', 'seo_title')} AS seo_title, ${tr('rt', 'seo_description')} AS seo_description,
            ${tr('dt', 'name')} AS destination_name,
            ARRAY(SELECT ${tr('ct', 'label')}
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                    ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
                   WHERE rc.restaurant_id = r.id AND ${tr('ct', 'label')} IS NOT NULL
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisines
       FROM restaurants r CROSS JOIN lc
       JOIN destinations d ON d.id = r.destination_id
       ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
      WHERE r.id = $2`,
    [locale, id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    page: 'restaurant',
    fields: nonEmpty([
      { label: 'Name', text: r.name },
      { label: 'Type', text: r.type_label },
      { label: 'Destination', text: r.destination_name },
      { label: 'Cuisines', text: r.cuisines.join(', ') },
      { label: 'Line above the name', text: r.kicker },
      { label: 'Story', text: r.story },
      { label: 'Current SEO title', text: r.seo_title },
      { label: 'Current SEO description', text: r.seo_description },
    ]),
  };
}

/** The home page's own words (registry keys, as guests read them in the language). */
const HOME_KEYS = [
  'hero.kicker',
  'hero.title_1',
  'hero.title_2',
  'hero.title_3',
  'hero.lede',
  'destinations.title',
  'destinations.lede',
  'heritage.kicker',
  'heritage.title_1',
  'heritage.title_2',
  'seo.home_title',
  'seo.home_description',
] as const satisfies readonly StringKey[];

/** The home page: its hero and section lines, and the catalogue it shows (published restaurants at published destinations). */
async function homeMaterial(db: Db, locale: string): Promise<SeoMaterial> {
  const [{ defaultLocale, rows }, restaurants, destinations, cuisines] = await Promise.all([
    loadStringRows(locale, HOME_KEYS, db),
    db.query<{ name: string; type_label: string | null }>(
      `WITH ${LOCALE_CTE}
       SELECT r.name, ${tr('rt', 'type_label')} AS type_label
         FROM restaurants r CROSS JOIN lc
         JOIN destinations d ON d.id = r.destination_id AND d.is_published
         ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
        WHERE r.is_published AND r.archived_at IS NULL
        ORDER BY r.sort_order, r.id`,
      [locale],
    ),
    db.query<{ name: string }>(
      `WITH ${LOCALE_CTE}
       SELECT ${tr('dt', 'name')} AS name
         FROM destinations d CROSS JOIN lc
         ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
        WHERE d.is_published AND ${tr('dt', 'name')} IS NOT NULL
        ORDER BY d.sort_order, d.id`,
      [locale],
    ),
    db.query<{ label: string }>(
      `WITH ${LOCALE_CTE}
       SELECT ${tr('ct', 'label')} AS label
         FROM cuisines c CROSS JOIN lc
         ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
        WHERE c.is_published AND ${tr('ct', 'label')} IS NOT NULL
        ORDER BY c.sort_order, c.id`,
      [locale],
    ),
  ]);
  const t = resolveStrings(rows, HOME_KEYS, locale, defaultLocale);
  return {
    page: 'home',
    fields: nonEmpty([
      { label: 'Hero', text: [t['hero.kicker'], t['hero.title_1'], t['hero.title_2'], t['hero.title_3']].join(' ') },
      { label: 'Hero text', text: t['hero.lede'] },
      { label: 'Destinations', text: destinations.rows.map((d) => d.name).join(', ') },
      { label: 'Destinations text', text: `${t['destinations.title']}. ${t['destinations.lede']}` },
      { label: 'Restaurants', text: restaurants.rows.map((r) => (r.type_label ? `${r.name} (${r.type_label})` : r.name)).join('; ') },
      { label: 'Cuisines', text: cuisines.rows.map((c) => c.label).join(', ') },
      { label: 'Heritage', text: [t['heritage.kicker'], t['heritage.title_1'], t['heritage.title_2']].join(' ') },
      { label: 'Current title', text: t['seo.home_title'] },
      { label: 'Current description', text: t['seo.home_description'] },
    ]),
  };
}
