import 'server-only';

/*
 * SQL fragments shared by the content queries (spec §5.1 item 5). Every query
 * that uses them takes the requested locale as $1 and starts with
 * `WITH ${LOCALE_CTE}`, which names the default language (lc.def) and whether
 * $1 serves machine translations (lc.machine). Identifiers passed in are code
 * constants, never input.
 *
 * locales.is_enabled is not checked here (R16): the proxy and the (guarded)
 * layout decide which languages a guest may open, and phase 8's Draft Mode
 * must render a language that is not on yet.
 */

export const LOCALE_CTE = `lc AS (
  SELECT coalesce((SELECT code FROM locales WHERE is_default), 'en') AS def,
         coalesce((SELECT serve_machine FROM locales WHERE code = $1), false) AS machine
)`;

/** A translation row a guest may see in $1: the default language always, another one when reviewed (or machine, if it serves those). */
const visible = (alias: string) =>
  `(${alias}.locale = lc.def OR ${alias}.status = 'reviewed' OR (${alias}.status = 'machine' AND lc.machine))`;

/**
 * Joins `table` twice: `alias` (the row in $1, when visible) and `alias_d`
 * (the default language's). Read a field with tr(alias, column).
 */
export function i18nJoin(table: string, alias: string, fk: string, parent: string): string {
  return `LEFT JOIN ${table} ${alias} ON ${alias}.${fk} = ${parent} AND ${alias}.locale = $1 AND ${visible(alias)}
  LEFT JOIN ${table} ${alias}_d ON ${alias}_d.${fk} = ${parent} AND ${alias}_d.locale = lc.def`;
}

/** One translatable field, falling back to the default language on its own (NULL means "not translated": CHECKs forbid blanks). */
export const tr = (alias: string, column: string) => `coalesce(${alias}.${column}, ${alias}_d.${column})`;

/**
 * An image as JSON ({url, alt, width, height, blur?}) or NULL, for `idExpr`:
 * alt in $1, else the default language's, and "" for a decorative image. Use
 * as `LEFT JOIN LATERAL ${mediaJson('x.image_id')} AS img ON true` and select
 * img.j. `blur` (blur_data_url, phase 7 uploads) is present only when the
 * file has one: the static files have none, and their shape stays as it was.
 */
export function mediaJson(idExpr: string): string {
  return `(SELECT jsonb_build_object(
            'url', m.url, 'width', m.width, 'height', m.height,
            'alt', CASE WHEN m.is_decorative THEN '' ELSE coalesce(ma.alt, ma_d.alt, '') END)
          || CASE WHEN m.blur_data_url IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('blur', m.blur_data_url) END AS j
     FROM media m
     ${i18nJoin('media_i18n', 'ma', 'media_id', 'm.id')}
    WHERE m.id = ${idExpr} AND m.deleted_at IS NULL)`;
}

/** Today in Da Nang, the day offers are shown for (spec §5.1 item 8; the offers loader). */
export const VENUE_TODAY = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
