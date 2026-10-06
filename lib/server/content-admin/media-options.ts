import 'server-only';
import type { MediaOption } from '@/lib/admin/media-option';
import type { Db } from '@/lib/server/booking/rules';

export type { MediaOption };

/*
 * What ImagePicker offers (spec §7.3): the library's live files, images or
 * PDFs, with their EN alt. Soft-deleted files are left out: a row may still
 * point at one (RESTRICT holds the FK), and the picker then shows it as gone.
 */

export async function listMediaOptions(db: Db, kind: 'image' | 'pdf' = 'image'): Promise<MediaOption[]> {
  const { rows } = await db.query<MediaOption>(
    `SELECT m.id::text, m.url, m.pathname, mi.alt, m.width, m.height, m.is_decorative AS "isDecorative",
            CASE WHEN m.content_type = 'application/pdf' THEN 'pdf' ELSE 'image' END AS kind
       FROM media m
       -- The picker describes a file by its default-language alt (the admin's language for content, spec §7).
       LEFT JOIN media_i18n mi ON mi.media_id = m.id AND mi.locale = 'en'
      WHERE m.deleted_at IS NULL AND (m.content_type = 'application/pdf') = ($1 = 'pdf')
      ORDER BY m.created_at DESC, m.pathname`,
    [kind],
  );
  return rows;
}
