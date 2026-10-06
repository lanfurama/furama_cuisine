import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { catalogLanguage, LANGUAGE_CATALOG, type CatalogLanguage } from '@/lib/i18n/catalog';
import { registryLocaleDefault, type StringKey } from '@/lib/i18n/registry';
import { GUEST_EMAIL_EVENTS } from '@/lib/email/events';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { US, conflictBy, type Conflict } from '@/lib/server/booking/config';
import type { Db } from '@/lib/server/booking/rules';
import { emailKeys } from '@/lib/server/email/booking/render';
import { makeListEditor, type ListFailure } from './list-editor';
import { readItems, snapshotToken } from './snapshot';
import { SOCIAL_LINK, SOCIAL_NAMES } from './socials';

/*
 * /admin/locales (spec §8, §7.1: Admin only). Every write is one transaction
 * with its audit_log row (entity 'locales', entity_id the code) and the table's
 * one token: the newest updated_at of any row, so two Admins never overwrite
 * each other (the second gets "vừa được … thay đổi"). The rules, each refused
 * here and not only in the page:
 * - a language is added only from the catalogue (lib/i18n/catalog.ts), off,
 *   last in the order; its code never changes after (R8-1);
 * - it is enabled only once every guest email key has a text in it, a
 *   reviewed content_strings row or the registry's own (R8-6, phase-5 R10):
 *   a guest who booked in it must never get an English email under its dates;
 * - the default language is never disabled or deleted, and only a disabled
 *   language with nothing that must keep it is deleted (R8-2): no booking, no
 *   queued email, no recipient, no policy version, no social link naming it
 *   (the trigger of migration 010 refuses the last one too).
 * The action expires tagsForLocales(changed) after the commit.
 */

export type LocaleRow = {
  code: string;
  bcp47: string;
  nativeName: string;
  shortLabel: string;
  script: string;
  isDefault: boolean;
  isEnabled: boolean;
  serveMachine: boolean;
};

type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };
type NotFound = { ok: false; code: 'not_found' };
export type LocaleFailure = Invalid | NotFound | Conflict;
export type LocaleResult = { ok: true; data: { changed: string[] } } | LocaleFailure;

const invalid = (message: string, field = 'code'): Invalid => ({ ok: false, code: 'invalid', fieldErrors: { [field]: [message] } });

const SELECT = `SELECT code, bcp47, native_name AS "nativeName", short_label AS "shortLabel", script,
                       is_default AS "isDefault", is_enabled AS "isEnabled", serve_machine AS "serveMachine"
                  FROM locales`;

/** Every language in the table, in the site's order, and the table's token. */
export async function listLocalesAdmin(db: Db): Promise<{ locales: LocaleRow[]; token: string }> {
  const [{ rows }, token] = await Promise.all([db.query<LocaleRow>(`${SELECT} ORDER BY sort_order, code`), tableToken(db)]);
  return { locales: rows, token };
}

/** The catalogue's languages not in the table yet: what "Thêm ngôn ngữ" offers. */
export async function addableLanguages(db: Db): Promise<CatalogLanguage[]> {
  const { rows } = await db.query<{ code: string }>('SELECT code FROM locales');
  const taken = new Set(rows.map((r) => r.code));
  return LANGUAGE_CATALOG.filter((l) => !taken.has(l.code));
}

async function tableToken(db: Db): Promise<string> {
  const { rows } = await db.query<{ token: string | null }>(`SELECT ${US('max(updated_at)')} AS token FROM locales`);
  return rows[0]?.token ?? '';
}

/** Locks the table for a write and checks the page's token; the conflict names whoever changed it last. */
async function lockTable(client: PoolClient, token: string): Promise<Conflict | null> {
  await client.query('LOCK TABLE locales IN SHARE ROW EXCLUSIVE MODE');
  if ((await tableToken(client)) === token) return null;
  const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>(
    'SELECT updated_by, updated_at FROM locales ORDER BY updated_at DESC LIMIT 1',
  );
  return conflictBy(client, rows[0]?.updated_by ?? null, rows[0]?.updated_at ?? new Date());
}

async function rowOf(client: PoolClient, code: string): Promise<LocaleRow | null> {
  const { rows } = await client.query<LocaleRow>(`${SELECT} WHERE code = $1`, [code]);
  return rows[0] ?? null;
}

/** Adds a language from the catalogue, off and last (spec §8 step 1). */
export async function addLocale(pool: Pool, actor: AuditActor, input: { code: string; token: string }): Promise<LocaleResult> {
  const language = catalogLanguage(input.code);
  if (!language) return invalid('Ngôn ngữ không có trong danh sách.');
  return withTransaction(pool, async (client) => {
    const conflict = await lockTable(client, input.token);
    if (conflict) return conflict;
    if (await rowOf(client, language.code)) return invalid('Ngôn ngữ này đã có.');
    await client.query(
      `INSERT INTO locales (code, bcp47, native_name, short_label, script, is_default, is_enabled, serve_machine, sort_order, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, false, false, false, (SELECT coalesce(max(sort_order), 0) + 10 FROM locales), now(), $6)`,
      [language.code, language.bcp47, language.nativeName, language.shortLabel, language.script, actor.id],
    );
    await insertAudit(client, actor, { action: 'create', entityType: 'locales', entityId: language.code, after: await rowOf(client, language.code) });
    return { ok: true, data: { changed: [language.code] } };
  });
}

/**
 * The guest email keys `code` has no text for: neither a reviewed
 * content_strings row nor a registry default in that language (R8-6).
 */
export async function missingGuestEmailKeys(db: Db, code: string): Promise<StringKey[]> {
  const keys = [...new Set(GUEST_EMAIL_EVENTS.flatMap((event) => emailKeys(event)))] as StringKey[];
  const { rows } = await db.query<{ key: string }>(
    `SELECT key FROM content_strings WHERE locale = $1 AND key = ANY($2::text[]) AND status = 'reviewed'`,
    [code, keys],
  );
  const saved = new Set(rows.map((r) => r.key));
  return keys.filter((key) => !saved.has(key) && registryLocaleDefault(key, code) === undefined);
}

/** Turns a language on or off for guests (spec §8 step 4). */
export async function setLocaleEnabled(
  pool: Pool,
  actor: AuditActor,
  input: { code: string; enabled: boolean; token: string },
): Promise<LocaleResult> {
  return withTransaction(pool, async (client) => {
    const conflict = await lockTable(client, input.token);
    if (conflict) return conflict;
    const before = await rowOf(client, input.code);
    if (!before) return { ok: false, code: 'not_found' };
    if (before.isEnabled === input.enabled) return { ok: true, data: { changed: [] } };
    if (!input.enabled && before.isDefault) return invalid('Không tắt được ngôn ngữ mặc định.');
    if (input.enabled) {
      const missing = await missingGuestEmailKeys(client, input.code);
      if (missing.length) return invalid(`Chưa có bản dịch cho ${missing.length} chữ trong email gửi khách: ${missing.join(', ')}.`, 'emails');
    }
    await client.query('UPDATE locales SET is_enabled = $2, updated_at = now(), updated_by = $3 WHERE code = $1', [input.code, input.enabled, actor.id]);
    await insertAudit(client, actor, { action: 'update', entityType: 'locales', entityId: input.code, before, after: await rowOf(client, input.code) });
    return { ok: true, data: { changed: [input.code] } };
  });
}

/** Whether guests see machine translations in a language (spec §3 serve_machine; off: reviewed only, else English). */
export async function setServeMachine(pool: Pool, actor: AuditActor, input: { code: string; on: boolean; token: string }): Promise<LocaleResult> {
  return withTransaction(pool, async (client) => {
    const conflict = await lockTable(client, input.token);
    if (conflict) return conflict;
    const before = await rowOf(client, input.code);
    if (!before) return { ok: false, code: 'not_found' };
    if (before.serveMachine === input.on) return { ok: true, data: { changed: [] } };
    await client.query('UPDATE locales SET serve_machine = $2, updated_at = now(), updated_by = $3 WHERE code = $1', [input.code, input.on, actor.id]);
    await insertAudit(client, actor, { action: 'update', entityType: 'locales', entityId: input.code, before, after: await rowOf(client, input.code) });
    return { ok: true, data: { changed: [input.code] } };
  });
}

/** Moves a language one place up or down in the switcher's order. */
export async function moveLocale(pool: Pool, actor: AuditActor, input: { code: string; direction: 'up' | 'down'; token: string }): Promise<LocaleResult> {
  return withTransaction(pool, async (client) => {
    const conflict = await lockTable(client, input.token);
    if (conflict) return conflict;
    const { rows } = await client.query<{ code: string }>('SELECT code FROM locales ORDER BY sort_order, code');
    const order = rows.map((r) => r.code);
    const at = order.indexOf(input.code);
    if (at < 0) return { ok: false, code: 'not_found' };
    const to = input.direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= order.length) return { ok: true, data: { changed: [] } };
    [order[at], order[to]] = [order[to], order[at]];
    await client.query(
      `UPDATE locales l SET sort_order = o.n * 10, updated_at = now(), updated_by = $2
         FROM unnest($1::text[]) WITH ORDINALITY AS o(code, n) WHERE l.code = o.code AND l.sort_order <> o.n * 10`,
      [order, actor.id],
    );
    await insertAudit(client, actor, { action: 'reorder', entityType: 'locales', entityId: null, before: { order: rows.map((r) => r.code) }, after: { order } });
    // The order is the switcher's and the sitemap's, both under `locales`; no language's fallback changes.
    return { ok: true, data: { changed: [] } };
  });
}

/** What deleting `code` would take with it: the confirmation names the numbers (R8-2). */
export async function deleteImpact(db: Db, code: string): Promise<{ translations: number; strings: number }> {
  const { rows } = await db.query<{ translations: number; strings: number }>(
    `SELECT (SELECT count(*) FROM destination_i18n WHERE locale = $1) + (SELECT count(*) FROM cuisine_i18n WHERE locale = $1)
          + (SELECT count(*) FROM restaurant_i18n WHERE locale = $1) + (SELECT count(*) FROM restaurant_highlight_i18n WHERE locale = $1)
          + (SELECT count(*) FROM experience_i18n WHERE locale = $1) + (SELECT count(*) FROM story_i18n WHERE locale = $1)
          + (SELECT count(*) FROM offer_i18n WHERE locale = $1) + (SELECT count(*) FROM nav_item_i18n WHERE locale = $1)
          + (SELECT count(*) FROM media_i18n WHERE locale = $1) + (SELECT count(*) FROM closure_i18n WHERE locale = $1) AS translations,
            (SELECT count(*) FROM content_strings WHERE locale = $1) AS strings`,
    [code],
  );
  return { translations: Number(rows[0].translations), strings: Number(rows[0].strings) };
}

/** Deletes a disabled language with nothing that must keep it; its translations go with it (CASCADE). */
export async function deleteLocale(pool: Pool, actor: AuditActor, input: { code: string; token: string }): Promise<LocaleResult> {
  return withTransaction(pool, async (client) => {
    const conflict = await lockTable(client, input.token);
    if (conflict) return conflict;
    const before = await rowOf(client, input.code);
    if (!before) return { ok: false, code: 'not_found' };
    if (before.isDefault) return invalid('Không xóa được ngôn ngữ mặc định.');
    if (before.isEnabled) return invalid('Tắt ngôn ngữ trước khi xóa.');
    const { rows } = await client.query<{ bookings: number; outbox: number; recipients: number; versions: number; socials: string[] }>(
      `SELECT (SELECT count(*) FROM reservations WHERE locale = $1 OR consent_locale = $1)::int AS bookings,
              (SELECT count(*) FROM email_outbox WHERE locale = $1)::int AS outbox,
              (SELECT count(*) FROM notification_recipients WHERE locale = $1)::int AS recipients,
              (SELECT count(*) FROM legal_versions WHERE locale = $1)::int AS versions,
              coalesce((SELECT array_agg(platform ORDER BY sort_order) FROM social_links WHERE $1 = ANY (visible_locales)), '{}') AS socials`,
      [input.code],
    );
    const r = rows[0];
    if (r.bookings) return invalid(`Ngôn ngữ này đã có ${r.bookings} đặt bàn, chỉ tắt được.`);
    if (r.outbox) return invalid(`Đã có ${r.outbox} email gửi bằng ngôn ngữ này, chỉ tắt được.`);
    if (r.recipients) return invalid(`${r.recipients} người nhận thông báo đang dùng ngôn ngữ này: đổi ngôn ngữ của họ trước.`);
    if (r.versions) return invalid('Đã có phiên bản chính sách bằng ngôn ngữ này, chỉ tắt được.');
    if (r.socials.length) {
      const names = r.socials.map((p) => SOCIAL_NAMES[p as keyof typeof SOCIAL_NAMES] ?? p).join(', ');
      return invalid(`Link ${names} đang hiện ở ngôn ngữ này: sửa ở mục “Link mạng xã hội” bên dưới trước.`);
    }
    const impact = await deleteImpact(client, input.code);
    await client.query('DELETE FROM locales WHERE code = $1', [input.code]);
    await insertAudit(client, actor, { action: 'delete', entityType: 'locales', entityId: input.code, before: { ...before, ...impact } });
    return { ok: true, data: { changed: [input.code] } };
  });
}

// ── which languages show each social link (R39, L8-6) ─────────────────────

/*
 * social_links.visible_locales, edited here rather than on the contact screen
 * (R39). Through makeListEditor on the same ItemDef, so the link's History and
 * restore stay one: a save writes this column only.
 */
const socialLocales = makeListEditor<{ visibleLocales: string[] | null }>(SOCIAL_LINK, {
  listKey: 'social_links',
  toRow: (input) => ({ visible_locales: input.visibleLocales }),
  async validate(client, { row }): Promise<ListFailure | null> {
    const chosen = row.visible_locales as string[] | null;
    if (chosen === null) return null;
    if (chosen.length === 0) return invalid('Chọn ít nhất một ngôn ngữ, hoặc “Mọi ngôn ngữ”.', 'visibleLocales');
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM locales WHERE code = ANY($1::text[])', [chosen]);
    return rows[0].n === new Set(chosen).size ? null : invalid('Ngôn ngữ không tồn tại.', 'visibleLocales');
  },
});

export const saveSocialLocales = socialLocales.update;

export type SocialLocalesItem = { id: string; name: string; token: string; visibleLocales: string[] | null };

/** Every social link with the languages it shows in (null: every one), in the footer's order. */
export async function listSocialLocales(db: Db): Promise<SocialLocalesItem[]> {
  return (await readItems(db, SOCIAL_LINK)).map((s) => ({
    id: String(s.row.id),
    name: SOCIAL_NAMES[s.row.platform as keyof typeof SOCIAL_NAMES] ?? String(s.row.platform),
    token: snapshotToken(s),
    visibleLocales: (s.row.visible_locales as string[] | null) ?? null,
  }));
}
