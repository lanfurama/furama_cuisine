import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { ContentTable } from '@/lib/cache-plan';
import { EDIT_SCREENS } from '@/lib/admin/content-screens';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { ADMIN_SCREENS, REGISTRY, keysForScreen, registryLocaleDefault, type AdminScreen, type StringKey } from '@/lib/i18n/registry';
import { sourceHash, translationState, type TranslationState } from '@/lib/i18n/source-hash';
import { insertAudit, withTransaction, type AuditActor } from '../audit';
import { US, conflictBy, type Conflict } from '../booking/config';
import { MEDIA } from '../media/library';
import { stringSource } from '../content/strings-admin';
import { CUISINE } from './cuisines';
import { DESTINATION } from './destinations';
import { EXPERIENCE } from './experiences';
import { NAV_ITEM } from './nav';
import { OFFER } from './offers';
import { HIGHLIGHT, RESTAURANT, readRestaurant } from './restaurants';
import { readItem, type ItemDef } from './snapshot';
import { STORY } from './stories';

/*
 * /admin/translations (spec §7, §8 steps 2 and "Hàng chờ duyệt"): how much of
 * each kind of content every language has, and the queue of translations that
 * need a person: machine translations (any language, English alt text an AI
 * wrote included) and translations whose English moved on ("EN đã đổi").
 *
 * A kind is a translatable table (an ItemDef with i18n) or the registry keys
 * of one strings screen. States come from translationState against the
 * fingerprint of the default row (lib/i18n/source-hash.ts), computed here in
 * Node: the tables hold hundreds of rows, not thousands.
 *
 * "Duyệt" and "Vẫn đúng" touch only a row's bookkeeping (status, source_hash,
 * reviewed_*): the text stays, the item's form token stays (snapshotToken
 * leaves bookkeeping out), and the item's History gets a row with the item's
 * whole snapshot on either side, as every other write of it.
 */

type Db = Pool | PoolClient;

/** One kind of translatable content. */
type ItemKind = {
  kind: 'item';
  key: string;
  label: string;
  def: ItemDef;
  /** The counted items: id, the item that owns it (a highlight's restaurant), and a WHERE on `m`. */
  owner: string;
  where: string;
  href: (id: string, owner: string | null) => string;
  /** How a review is recorded in the History of the item's own screen; null: reviewed on that screen only. */
  audit: { entityType: string; entityId: (id: string, owner: string | null) => string; read: (db: Db, id: string, owner: string | null) => Promise<object | null> } | null;
  tables: readonly ContentTable[];
};
type StringsKind = { kind: 'strings'; key: string; label: string; screen: AdminScreen; href: string };
export type ContentKind = ItemKind | StringsKind;

const item = (def: ItemDef, label: string, href: (id: string, owner: string | null) => string, extra: Partial<ItemKind> = {}): ItemKind => ({
  kind: 'item',
  key: def.entityType,
  label,
  def,
  owner: 'NULL',
  where: 'true',
  href,
  audit: { entityType: def.entityType, entityId: (id) => id, read: (db, id) => readItem(db, def, id) },
  tables: def.tables,
  ...extra,
});

const CLOSURE_TEXT: ItemDef = {
  entityType: 'closure',
  table: 'closures',
  idType: 'bigint',
  columns: [],
  i18n: { table: 'closure_i18n', fk: 'closure_id', columns: ['public_reason'] },
  tables: [],
};

const SCREEN_LABELS: Record<AdminScreen, string> = {
  hero: 'Chữ: hero',
  cuisines: 'Chữ: ẩm thực',
  restaurants: 'Chữ: nhà hàng',
  destinations: 'Chữ: điểm đến',
  experiences: 'Chữ: Experiences',
  heritage: 'Chữ: Heritage',
  stories: 'Chữ: Stories',
  offers: 'Chữ: ưu đãi',
  booking: 'Chữ: đặt bàn',
  navigation: 'Chữ: menu',
  contact: 'Chữ: liên hệ và chân trang',
  seo: 'Chữ: SEO',
  legal: 'Chính sách bảo mật',
  emails: 'Email',
  'ui-text': 'Chữ giao diện',
};

export const CONTENT_KINDS: readonly ContentKind[] = [
  item(OFFER, 'Ưu đãi', (id) => `/admin/content/offers/${id}`),
  item(CUISINE, 'Ẩm thực', () => '/admin/content/cuisines'),
  item(DESTINATION, 'Điểm đến', () => '/admin/content/destinations'),
  item(EXPERIENCE, 'Experiences', () => '/admin/content/experiences'),
  item(STORY, 'Stories', () => '/admin/content/stories'),
  item(NAV_ITEM, 'Menu', () => '/admin/content/navigation'),
  item(RESTAURANT, 'Nhà hàng', (id) => `/admin/restaurants/${id}`, {
    where: 'm.archived_at IS NULL',
    audit: { entityType: RESTAURANT.entityType, entityId: (id) => id, read: (db, id) => readRestaurant(db, id) },
  }),
  // A highlight is part of its restaurant: saved, restored and audited with it.
  item(HIGHLIGHT, 'Điểm nổi bật', (_id, owner) => `/admin/restaurants/${owner}`, {
    owner: 'm.restaurant_id',
    where: 'EXISTS (SELECT 1 FROM restaurants r WHERE r.id = m.restaurant_id AND r.archived_at IS NULL)',
    audit: { entityType: RESTAURANT.entityType, entityId: (_id, owner) => owner!, read: (db, _id, owner) => readRestaurant(db, owner!) },
    tables: RESTAURANT.tables,
  }),
  item(MEDIA, 'Alt ảnh', (id) => `/admin/media/${id}`, { where: 'm.deleted_at IS NULL' }),
  // Closures belong to the schedule (schedule:update): counted here, reviewed on their own screen.
  item(CLOSURE_TEXT, 'Lý do đóng cửa', () => '/admin/reservations/closures', { where: 'm.ends_on >= current_date', audit: null }),
  ...ADMIN_SCREENS.map((screen): StringsKind => ({
    kind: 'strings',
    key: `strings:${screen}`,
    label: SCREEN_LABELS[screen],
    screen,
    href: EDIT_SCREENS[screen].route,
  })),
];

export const kindByKey = (key: string): ContentKind | undefined => CONTENT_KINDS.find((k) => k.key === key);

/** One translation (or missing one) of one item or key in one language. */
type Unit = {
  kind: ContentKind;
  /** The item id, or the string key. */
  id: string;
  owner: string | null;
  locale: string;
  state: TranslationState;
  /** status = 'machine' (a default-language row too: English alt text an AI wrote). */
  machine: boolean;
  english: string;
  translation: string | null;
  token: string;
};

type I18nLoaded = Record<string, unknown> & { id: string; locale: string; status: string; source_hash: string | null; token: string };

/** What the queue shows of a row: its words, not a menu file's id or a link (those still count in the fingerprint). */
const text = (row: Record<string, unknown> | undefined, columns: readonly string[]) =>
  columns
    .filter((c) => !/(_id|_url|href)$/.test(c))
    .map((c) => row?.[c])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(String)
    .join(' · ');

async function itemUnits(db: Db, kind: ItemKind, locales: readonly string[]): Promise<Unit[]> {
  const { def } = kind;
  const i18n = def.i18n!;
  const { rows: items } = await db.query<{ id: string; owner: string | null }>(
    `SELECT m.id::text AS id, ${kind.owner}::text AS owner FROM ${def.table} m WHERE ${kind.where} ORDER BY m.id`,
  );
  const ids = items.map((i) => i.id);
  const { rows } = await db.query<I18nLoaded>(
    `SELECT t.${i18n.fk}::text AS id, t.locale, t.status, t.source_hash, ${US('t.updated_at')} AS token, ${i18n.columns.map((c) => `t.${c}`).join(', ')}
       FROM ${i18n.table} t WHERE t.${i18n.fk}::text = ANY($1::text[])`,
    [ids],
  );
  const at = new Map(rows.map((r) => [`${r.id}\u0000${r.locale}`, r]));
  const units: Unit[] = [];
  for (const { id, owner } of items) {
    const english = at.get(`${id}\u0000${DEFAULT_LOCALE}`);
    // Only what has English text is there to translate.
    if (!text(english, i18n.columns)) continue;
    const current = sourceHash(i18n.columns, english);
    for (const locale of locales) {
      const row = at.get(`${id}\u0000${locale}`);
      const isDefault = locale === DEFAULT_LOCALE;
      units.push({
        kind,
        id,
        owner,
        locale,
        state: translationState(row, current, isDefault),
        machine: row?.status === 'machine',
        english: text(english, i18n.columns),
        translation: row ? text(row, i18n.columns) : null,
        token: row?.token ?? '',
      });
    }
  }
  return units;
}

async function stringUnits(db: Db, kind: StringsKind, locales: readonly string[]): Promise<Unit[]> {
  const keys = keysForScreen(kind.screen);
  const { rows } = await db.query<{ key: string; locale: string; value: string; status: string; source_hash: string | null; token: string }>(
    `SELECT key, locale, value, status, source_hash, ${US('updated_at')} AS token FROM content_strings WHERE key = ANY($1::text[])`,
    [keys],
  );
  const at = new Map(rows.map((r) => [`${r.key}\u0000${r.locale}`, r]));
  const units: Unit[] = [];
  for (const key of keys) {
    const english = at.get(`${key}\u0000${DEFAULT_LOCALE}`)?.value ?? REGISTRY[key].en;
    const current = stringSource(english);
    for (const locale of locales) {
      const row = at.get(`${key}\u0000${locale}`);
      const own = registryLocaleDefault(key, locale);
      // The registry's own translation (email.*, legal.* in Vietnamese) is a reviewed one without a row.
      const shown = row ?? (own !== undefined ? { status: 'reviewed' } : null);
      units.push({
        kind,
        id: key,
        owner: null,
        locale,
        state: translationState(shown, current, locale === DEFAULT_LOCALE),
        machine: row?.status === 'machine',
        english,
        translation: row?.value ?? own ?? null,
        token: row?.token ?? '',
      });
    }
  }
  return units;
}

async function allLocales(db: Db): Promise<{ code: string; name: string }[]> {
  const { rows } = await db.query<{ code: string; native_name: string }>('SELECT code, native_name FROM locales ORDER BY is_default DESC, sort_order, code');
  return rows.map((r) => ({ code: r.code, name: r.native_name }));
}

async function allUnits(db: Db, kinds: readonly ContentKind[], locales: readonly string[]): Promise<Unit[]> {
  const out: Unit[] = [];
  for (const kind of kinds) out.push(...(kind.kind === 'item' ? await itemUnits(db, kind, locales) : await stringUnits(db, kind, locales)));
  return out;
}

export type CoverageCell = { total: number; reviewed: number; machine: number; stale: number; missing: number };
export type Coverage = { locales: { code: string; name: string }[]; kinds: { key: string; label: string; cells: Record<string, CoverageCell> }[] };

/** Per kind and per language other than the default: how many of the items with English text are in each state. */
export async function coverage(db: Db): Promise<Coverage> {
  const locales = (await allLocales(db)).filter((l) => l.code !== DEFAULT_LOCALE);
  const all = await allUnits(
    db,
    CONTENT_KINDS,
    locales.map((l) => l.code),
  );
  const kinds = CONTENT_KINDS.map((kind) => {
    const cells: Record<string, CoverageCell> = {};
    for (const { code } of locales) cells[code] = { total: 0, reviewed: 0, machine: 0, stale: 0, missing: 0 };
    for (const u of all) {
      if (u.kind !== kind) continue;
      const cell = cells[u.locale];
      cell.total += 1;
      cell[u.state] += 1;
    }
    return { key: kind.key, label: kind.label, cells };
  });
  return { locales, kinds };
}

export type CoverageSummary = { code: string; name: string; percent: number; stale: number };

/** One line per language other than the default: the share of reviewed translations, and how many are "EN đã đổi" (the dashboard, /admin/locales). */
export async function coverageSummary(db: Db): Promise<CoverageSummary[]> {
  const { locales, kinds } = await coverage(db);
  return locales.map(({ code, name }) => {
    const sum = kinds.reduce(
      (acc, k) => ({ total: acc.total + k.cells[code].total, reviewed: acc.reviewed + k.cells[code].reviewed, stale: acc.stale + k.cells[code].stale }),
      { total: 0, reviewed: 0, stale: 0 },
    );
    return { code, name, percent: sum.total ? Math.floor((sum.reviewed / sum.total) * 100) : 100, stale: sum.stale };
  });
}

export type QueueItem = {
  kind: string;
  kindLabel: string;
  id: string;
  locale: string;
  /** Why it waits: an AI wrote it, or its English changed since. */
  reason: 'machine' | 'stale';
  english: string;
  translation: string;
  token: string;
  href: string;
  /** "Duyệt" and "Vẫn đúng" are offered here (closures are reviewed on their own screen). */
  reviewable: boolean;
};

export const QUEUE_PAGE = 50;

/** The translations that need a person, filtered by language and kind, a page of QUEUE_PAGE at a time. */
export async function reviewQueue(db: Db, filter: { locale?: string; kind?: string; page?: number } = {}): Promise<{ items: QueueItem[]; total: number }> {
  const codes = (await allLocales(db)).map((l) => l.code).filter((c) => !filter.locale || c === filter.locale);
  const kinds = CONTENT_KINDS.filter((k) => !filter.kind || k.key === filter.kind);
  const waiting = (await allUnits(db, kinds, codes)).filter((u) => u.machine || u.state === 'stale');
  const page = Math.max(1, filter.page ?? 1);
  const items = waiting.slice((page - 1) * QUEUE_PAGE, page * QUEUE_PAGE).map(
    (u): QueueItem => ({
      kind: u.kind.key,
      kindLabel: u.kind.label,
      id: u.id,
      locale: u.locale,
      reason: u.machine ? 'machine' : 'stale',
      english: u.english,
      translation: u.translation ?? '',
      token: u.token,
      href: u.kind.kind === 'item' ? u.kind.href(u.id, u.owner) : `${u.kind.href}?lang=${u.locale}#strings-${u.kind.screen}`,
      reviewable: u.kind.kind === 'strings' || u.kind.audit !== null,
    }),
  );
  return { items, total: waiting.length };
}

export type ReviewTarget = { kind: string; id: string; locale: string; token: string };
type Fail = { ok: false; code: 'not_found' } | { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> } | Conflict;
export type Reviewed = { tables: ContentTable[]; keys: StringKey[] };

const TOO_MANY = 'Mỗi lần duyệt tối đa 50 mục.';

/**
 * "Duyệt" (approve: a machine translation becomes reviewed) or "Vẫn đúng"
 * (confirm: an out-of-date translation still says what the English says) of
 * up to QUEUE_PAGE rows, in one transaction: each row locked and checked
 * against the token the page drew it with; the row's text kept; status
 * 'reviewed', reviewed_by/at, and the current English fingerprint; one audit
 * row per item. Returns what the caller expires (tagsForSave of the tables,
 * tagsForStrings of the keys).
 */
export async function reviewTranslations(
  pool: Pool,
  actor: AuditActor,
  targets: readonly ReviewTarget[],
): Promise<{ ok: true; data: Reviewed } | Fail> {
  if (targets.length === 0) return { ok: true, data: { tables: [], keys: [] } };
  if (targets.length > QUEUE_PAGE) return { ok: false, code: 'invalid', fieldErrors: { items: [TOO_MANY] } };
  for (const t of targets) {
    const kind = kindByKey(t.kind);
    if (!kind || (kind.kind === 'item' && !kind.audit)) return { ok: false, code: 'not_found' };
  }
  // One order for every review, so two batches cannot deadlock.
  const sorted = [...targets].sort((a, b) => `${a.kind}\u0000${a.id}\u0000${a.locale}`.localeCompare(`${b.kind}\u0000${b.id}\u0000${b.locale}`));
  try {
    return await withTransaction(pool, async (client) => {
      const tables = new Set<ContentTable>();
      const keys = new Set<StringKey>();
      for (const t of sorted) {
        const kind = kindByKey(t.kind)!;
        const failed = kind.kind === 'strings' ? await reviewString(client, actor, kind, t) : await reviewItem(client, actor, kind, t);
        // One refused row refuses the batch: thrown, so the rows before it roll back.
        if (failed) throw new Refused(failed);
        if (kind.kind === 'strings') keys.add(t.id as StringKey);
        else for (const table of kind.tables) tables.add(table);
      }
      return { ok: true, data: { tables: [...tables], keys: [...keys] } } as const;
    });
  } catch (err) {
    if (err instanceof Refused) return err.fail;
    throw err;
  }
}

class Refused extends Error {
  constructor(readonly fail: Fail) {
    super(fail.code);
  }
}

type RowLock = { status: string; source_hash: string | null; token: string; updated_by: string | null; updated_at: Date };

async function reviewItem(client: PoolClient, actor: AuditActor, kind: ItemKind, t: ReviewTarget): Promise<Fail | null> {
  const i18n = kind.def.i18n!;
  const { rows: found } = await client.query<{ owner: string | null }>(
    `SELECT ${kind.owner}::text AS owner FROM ${kind.def.table} m WHERE m.id::text = $1 AND ${kind.where}`,
    [t.id],
  );
  if (!found[0]) return { ok: false, code: 'not_found' };
  const owner = found[0].owner;
  const lock = await client.query<RowLock>(
    `SELECT status, source_hash, ${US('updated_at')} AS token, updated_by, updated_at FROM ${i18n.table} WHERE ${i18n.fk}::text = $1 AND locale = $2 FOR UPDATE`,
    [t.id, t.locale],
  );
  const row = lock.rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  if (row.token !== t.token) return conflictBy(client, row.updated_by, row.updated_at);
  const english = await client.query(`SELECT ${i18n.columns.join(', ')} FROM ${i18n.table} WHERE ${i18n.fk}::text = $1 AND locale = $2`, [t.id, DEFAULT_LOCALE]);
  const audit = kind.audit!;
  const before = await audit.read(client, t.id, owner);
  await client.query(
    `UPDATE ${i18n.table} SET status = 'reviewed', source_hash = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now(), updated_by = $4
      WHERE ${i18n.fk}::text = $1 AND locale = $2`,
    [t.id, t.locale, t.locale === DEFAULT_LOCALE ? row.source_hash : sourceHash(i18n.columns, english.rows[0]), actor.id],
  );
  await insertAudit(client, actor, {
    action: 'update',
    entityType: audit.entityType,
    entityId: audit.entityId(t.id, owner),
    locale: t.locale,
    before,
    after: await audit.read(client, t.id, owner),
  });
  return null;
}

async function reviewString(client: PoolClient, actor: AuditActor, kind: StringsKind, t: ReviewTarget): Promise<Fail | null> {
  if (!(keysForScreen(kind.screen) as readonly string[]).includes(t.id)) return { ok: false, code: 'not_found' };
  const key = t.id as StringKey;
  // The editor's lock of this key in this language (strings-admin.ts lockedString).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('content_strings:' || $1 || ':' || $2))`, [key, t.locale]);
  const lock = await client.query<RowLock & { value: string }>(
    `SELECT value, status, source_hash, ${US('updated_at')} AS token, updated_by, updated_at FROM content_strings WHERE key = $1 AND locale = $2`,
    [key, t.locale],
  );
  const row = lock.rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  if (row.token !== t.token) return conflictBy(client, row.updated_by, row.updated_at);
  const english = await client.query<{ value: string }>(`SELECT value FROM content_strings WHERE key = $1 AND locale = $2`, [key, DEFAULT_LOCALE]);
  await client.query(
    `UPDATE content_strings SET status = 'reviewed', source_hash = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now(), updated_by = $4
      WHERE key = $1 AND locale = $2`,
    [key, t.locale, t.locale === DEFAULT_LOCALE ? row.source_hash : stringSource(english.rows[0]?.value ?? REGISTRY[key].en), actor.id],
  );
  // The strings History's shape ({ value, overridden }): the text is the same on both sides, so it offers nothing to restore.
  await insertAudit(client, actor, {
    action: 'update',
    entityType: 'content_strings',
    entityId: key,
    locale: t.locale,
    before: { value: row.value, overridden: true, meta: { status: row.status } },
    after: { value: row.value, overridden: true, meta: { status: 'reviewed', reviewed: true } },
  });
  return null;
}
