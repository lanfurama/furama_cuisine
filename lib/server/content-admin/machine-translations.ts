import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { Db } from '@/db/client';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { REGISTRY, keysForScreen, registryLocaleDefault, type StringDef, type StringKey } from '@/lib/i18n/registry';
import { sourceHash } from '@/lib/i18n/source-hash';
import { AGREED_KEYS } from '@/lib/legal';
import { insertAudit, withTransaction } from '@/lib/server/audit';
import { vertexErrorCode } from '@/lib/server/ai/errors';
import { claimJob, endRun, saveProgress, strike, type ClaimedJob, type JobProgress } from '@/lib/server/ai/jobs';
import type { ModelId } from '@/lib/server/ai/models';
import { loadAiSettings } from '@/lib/server/ai/settings';
import { MAX_CHARS, MAX_ITEMS, translateItems, type TranslateItem, type Translated } from '@/lib/server/ai/translate';
import type { AiSettings } from '@/lib/admin/ai-schemas';
import { stringDefault, stringSource, validateValue } from '@/lib/server/content/strings-admin';
import { isRuleViolation, type ItemDef } from '@/lib/server/history/snapshot';
import { MEDIA } from '@/lib/server/media/library';
import { RESTAURANT } from './restaurants';
import { CONTENT_KINDS, type ContentKind } from './translations';

/*
 * Bulk machine translation (spec §9.3, R9-9, R9-17): what a job translates,
 * and the only writer of status='machine' content translations (L9-1).
 *
 * What is missing in a language is what /admin/translations counts as
 * "Chưa dịch" (translations.ts): an item with English text and no row in the
 * language, a registry key with English and neither a row nor the registry's
 * own translation. Left out: the privacy policy and the consent text
 * (AGREED_KEYS: a guest agrees to exactly those words, a person writes them),
 * decorative pictures and PDFs (no alt to translate), and closure reasons
 * (they belong to the schedule screen, whose History is booking's: staff
 * write them there).
 *
 * A "document" is one item (every text column of its English row) or up to
 * MAX_ITEMS keys of one strings screen: one model call. A machine row goes
 * only into an empty place (INSERT … ON CONFLICT DO NOTHING) and only while
 * the English it was translated from is still the English: a row a person
 * saved meanwhile, or a machine row, is never touched. Each write has its
 * audit row (R9-20 as corrected: action update for an item, create for a new
 * key, actor NULL, and `after.meta.machine` naming the model; meta is not
 * part of a form's token), in the transaction of the write, under the lock
 * the item's editor takes. Guests see a translation once a person reviews it
 * (lib/server/content/sql.ts), so a job expires no cache tag (R9-19).
 */

type ItemKind = Extract<ContentKind, { kind: 'item' }>;
type StringsKind = Extract<ContentKind, { kind: 'strings' }>;

export type ItemDoc = { type: 'item'; kind: ItemKind; id: string; owner: string | null; source: string; items: TranslateItem[] };
export type StringsDoc = { type: 'strings'; kind: StringsKind; items: TranslateItem[]; sources: Record<string, string> };
export type Doc = ItemDoc | StringsDoc;

/** One place a job fills, as progress.skipped and strikes name it: `<kind key>#<item id or string key>`. */
export const unitOf = (kind: ContentKind, id: string) => `${kind.key}#${id}`;
export const docUnits = (doc: Doc): string[] => (doc.type === 'item' ? [unitOf(doc.kind, doc.id)] : doc.items.map((i) => unitOf(doc.kind, i.id)));

/** The kinds a job fills: every kind of the coverage screen whose writes have a History here (closures do not). */
const JOB_KINDS = CONTENT_KINDS.filter((k) => k.kind === 'strings' || k.audit !== null);
/** A further condition on the counted items of a kind: only pictures that show alt text. */
const JOB_WHERE: Record<string, string> = { [MEDIA.entityType]: `NOT m.is_decorative AND m.content_type <> 'application/pdf'` };
const AGREED = new Set<string>(AGREED_KEYS);

/** The columns that hold words, as the review queue shows them (translations.ts `text`): not a file id, a link or an href. */
const wordColumns = (columns: readonly string[]) => columns.filter((c) => !/(_id|_url|href)$/.test(c));
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

const limitsCache = new Map<string, Record<string, number>>();

/** Each column's length limit from the table's CHECKs (`char_length(x) <= n`): the model is told it, and a longer answer is refused. */
async function columnLimits(db: Db, table: string): Promise<Record<string, number>> {
  const cached = limitsCache.get(table);
  if (cached) return cached;
  const { rows } = await db.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`, [table]);
  const limits: Record<string, number> = {};
  for (const { def } of rows) for (const m of def.matchAll(/(?:char_)?length\((\w+)\) <= (\d+)/g)) limits[m[1]] = Number(m[2]);
  limitsCache.set(table, limits);
  return limits;
}

async function itemDocs(db: Db, kind: ItemKind, locale: string): Promise<ItemDoc[]> {
  const { def } = kind;
  const i18n = def.i18n!;
  const limits = await columnLimits(db, i18n.table);
  const { rows } = await db.query<{ id: string; owner: string | null; english: Record<string, unknown> }>(
    `SELECT m.id::text AS id, ${kind.owner}::text AS owner, to_jsonb(d) AS english
       FROM ${def.table} m JOIN ${i18n.table} d ON d.${i18n.fk} = m.id AND d.locale = $1
      WHERE ${kind.where} AND ${JOB_WHERE[kind.key] ?? 'true'}
        AND NOT EXISTS (SELECT 1 FROM ${i18n.table} t WHERE t.${i18n.fk} = m.id AND t.locale = $2)
      ORDER BY m.id`,
    [DEFAULT_LOCALE, locale],
  );
  return rows.flatMap(({ id, owner, english }): ItemDoc[] => {
    const items = wordColumns(i18n.columns)
      .filter((c) => has(english[c]))
      .map((c): TranslateItem => ({ id: c, text: String(english[c]), context: `${kind.label}: ${c}`, ...(limits[c] ? { maxLength: limits[c] } : {}) }));
    return items.length ? [{ type: 'item', kind, id, owner, source: sourceHash(i18n.columns, english), items }] : [];
  });
}

/** The missing keys of one screen, in registry order, as documents of at most MAX_ITEMS keys and MAX_CHARS characters. */
async function stringsDocs(db: Db, kind: StringsKind, locale: string, skip: ReadonlySet<string>): Promise<StringsDoc[]> {
  const keys = keysForScreen(kind.screen).filter((k) => !AGREED.has(k));
  const { rows } = await db.query<{ key: string; locale: string; value: string }>(
    `SELECT key, locale, value FROM content_strings WHERE key = ANY($1::text[]) AND locale IN ($2, $3)`,
    [keys, DEFAULT_LOCALE, locale],
  );
  const at = new Map(rows.map((r) => [`${r.key}\u0000${r.locale}`, r.value]));
  const docs: StringsDoc[] = [];
  let doc: StringsDoc | null = null;
  let chars = 0;
  for (const key of keys) {
    if (at.has(`${key}\u0000${locale}`) || registryLocaleDefault(key, locale) !== undefined || skip.has(unitOf(kind, key))) continue;
    const english = at.get(`${key}\u0000${DEFAULT_LOCALE}`) ?? REGISTRY[key].en;
    if (!has(english)) continue;
    if (!doc || doc.items.length === MAX_ITEMS || (doc.items.length && chars + english.length > MAX_CHARS)) {
      doc = { type: 'strings', kind, items: [], sources: {} };
      docs.push(doc);
      chars = 0;
    }
    const def: StringDef = REGISTRY[key];
    doc.items.push({ id: key, text: english, context: def.context, maxLength: def.maxLength, vars: def.vars ?? [] });
    doc.sources[key] = stringSource(english);
    chars += english.length;
  }
  return docs;
}

/**
 * What a job for `locale` still has to translate: the first `limit` documents
 * in a stable order (the coverage screen's kinds, then id or registry order)
 * and how many places are missing in all, leaving out the `skip`ped ones.
 */
export async function missingDocs(db: Db, locale: string, limit: number, skip: ReadonlySet<string> = new Set()): Promise<{ docs: Doc[]; remaining: number }> {
  const all: Doc[] = [];
  for (const kind of JOB_KINDS) {
    if (kind.kind === 'strings') all.push(...(await stringsDocs(db, kind, locale, skip)));
    else all.push(...(await itemDocs(db, kind, locale)).filter((d) => !skip.has(unitOf(kind, d.id))));
  }
  return { docs: all.slice(0, limit), remaining: all.reduce((n, d) => n + docUnits(d).length, 0) };
}

/**
 * A machine translation of one item into `locale` (L9-1): its status
 * 'machine', origin 'ai', the model, and the English fingerprint; nobody's
 * review. Only into an empty place: false when the language already has a
 * row, whoever wrote it. Nothing here can write 'reviewed'.
 */
export async function insertMachineTranslation(
  client: PoolClient,
  def: ItemDef,
  id: string,
  locale: string,
  values: Record<string, string>,
  model: ModelId,
  source: string,
): Promise<boolean> {
  if (!def.i18n) throw new Error(`${def.entityType} has no translations`);
  const { table, fk, columns } = def.i18n;
  const written = columns.filter((c) => c in values);
  const { rowCount } = await client.query(
    `INSERT INTO ${table} (${fk}, locale, ${written.join(', ')}, status, origin, ai_model, source_hash, updated_at)
     VALUES ($1::${def.idType}, $2, ${written.map((_, i) => `$${i + 5}`).join(', ')}, 'machine', 'ai', $3, $4, now())
     ON CONFLICT (${fk}, locale) DO NOTHING`,
    [id, locale, model, source, ...written.map((c) => values[c])],
  );
  return rowCount === 1;
}

/** The same for one registry key: false when the key already has a row in `locale`. */
export async function insertMachineString(client: PoolClient, key: StringKey, locale: string, value: string, model: ModelId, source: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO content_strings (key, locale, value, status, origin, ai_model, source_hash, updated_at)
     VALUES ($1, $2, $3, 'machine', 'ai', $4, $5, now())
     ON CONFLICT (key, locale) DO NOTHING`,
    [key, locale, value, model, source],
  );
  return rowCount === 1;
}

/** One insert that a CHECK may refuse (a length the model overran, a blank) without losing the transaction. */
async function tryInsert(client: PoolClient, insert: () => Promise<boolean>): Promise<boolean | 'refused'> {
  await client.query('SAVEPOINT machine_row');
  try {
    const done = await insert();
    await client.query('RELEASE SAVEPOINT machine_row');
    return done;
  } catch (err) {
    if (!isRuleViolation(err)) throw err;
    await client.query('ROLLBACK TO SAVEPOINT machine_row');
    return 'refused';
  }
}

const machineMeta = (model: ModelId) => ({ machine: { model } });

type Written = { written: string[]; failed: string[] };

/** An item is written whole or not at all: a column the model got wrong leaves the item missing, to be tried again. */
async function writeItemDoc(pool: Pool, doc: ItemDoc, locale: string, results: Translated[], model: ModelId): Promise<Written> {
  const unit = unitOf(doc.kind, doc.id);
  if (results.length !== doc.items.length || results.some((r) => !r.ok)) return { written: [], failed: [unit] };
  const { def, owner: ownerExpr, where } = doc.kind;
  const i18n = def.i18n!;
  const audit = doc.kind.audit!;
  return withTransaction(pool, async (client): Promise<Written> => {
    // The locks the item's editor takes before it reads the version it replaces: a highlight's restaurant first.
    if (doc.owner !== null) await client.query(`SELECT 1 FROM ${RESTAURANT.table} WHERE id = $1 FOR UPDATE`, [doc.owner]);
    const { rows: live } = await client.query<{ owner: string | null }>(
      `SELECT ${ownerExpr}::text AS owner FROM ${def.table} m WHERE m.id = $1::${def.idType} AND ${where} FOR UPDATE OF m`,
      [doc.id],
    );
    // Gone, archived, or moved to another restaurant since the scan: the next scan decides.
    if (!live[0] || live[0].owner !== doc.owner) return { written: [], failed: [] };
    const english = await client.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(d) AS row FROM ${i18n.table} d WHERE d.${i18n.fk} = $1::${def.idType} AND d.locale = $2`, [
      doc.id,
      DEFAULT_LOCALE,
    ]);
    // The English changed since the scan: this translation follows old words; the next scan has the new ones.
    if (sourceHash(i18n.columns, english.rows[0]?.row) !== doc.source) return { written: [], failed: [] };
    const before = await audit.read(client, doc.id, doc.owner);
    const values = Object.fromEntries(results.map((r) => [r.id, (r as { text: string }).text]));
    const inserted = await tryInsert(client, () => insertMachineTranslation(client, def, doc.id, locale, values, model, doc.source));
    if (inserted === 'refused') return { written: [], failed: [unit] };
    if (!inserted) return { written: [], failed: [] };
    const after = await audit.read(client, doc.id, doc.owner);
    await insertAudit(client, null, {
      action: 'update',
      entityType: audit.entityType,
      entityId: audit.entityId(doc.id, doc.owner),
      locale,
      before,
      after: { ...after, meta: machineMeta(model) },
    });
    return { written: [unit], failed: [] };
  });
}

/** Each key on its own: the good ones are written, a refused one stays missing. */
async function writeStringsDoc(pool: Pool, doc: StringsDoc, locale: string, results: Translated[], model: ModelId): Promise<Written> {
  const out: Written = { written: [], failed: [] };
  const good: [StringKey, string][] = [];
  for (const item of doc.items) {
    const r = results.find((x) => x.id === item.id);
    const key = item.id as StringKey;
    // The editor's own checks too (spec §7.4): a machine row must be one a person could have saved.
    if (r?.ok && validateValue(key, r.text, locale).length === 0) good.push([key, r.text]);
    else out.failed.push(unitOf(doc.kind, key));
  }
  if (!good.length) return out;
  good.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return withTransaction(pool, async (client) => {
    for (const [key, value] of good) {
      // The editor's lock of this key in this language (strings-admin.ts lockedString).
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('content_strings:' || $1 || ':' || $2))`, [key, locale]);
      const english = await client.query<{ value: string }>(`SELECT value FROM content_strings WHERE key = $1 AND locale = $2`, [key, DEFAULT_LOCALE]);
      if (stringSource(english.rows[0]?.value ?? REGISTRY[key].en) !== doc.sources[key]) continue;
      const inserted = await tryInsert(client, () => insertMachineString(client, key, locale, value, model, doc.sources[key]));
      if (inserted === 'refused') {
        out.failed.push(unitOf(doc.kind, key));
        continue;
      }
      if (!inserted) continue;
      // The strings History's shape ({ value, overridden }), as a save of a new row writes it.
      await insertAudit(client, null, {
        action: 'create',
        entityType: 'content_strings',
        entityId: key,
        locale,
        before: { value: stringDefault(key, locale), overridden: false },
        after: { value, overridden: true, meta: machineMeta(model) },
      });
      out.written.push(unitOf(doc.kind, key));
    }
    return out;
  });
}

export type RunReport = { jobs: number; docs: number };
export type RunOptions = { budgetMs: number; ids?: readonly string[]; now?: () => number };

/** A run's time in a function of maxDuration 300 s (the buttons' after() and the cron, R9-2). */
export const RUN_BUDGET_MS = 240_000;
/** Documents per scan: after them the scan runs again, so a save, a resume or a second run in between is seen (R9-9). */
const BATCH = 20;
/** Left of the budget when a run stops starting documents: the last call (60 s timeout) and its write still fit. */
const MARGIN_MS = 30_000;

/**
 * Runs jobs until the budget is spent (R9-2, R9-16): the after() of
 * "Dịch tất cả…" or "Tiếp tục" (240 s, its own job) and the hourly cron
 * (whatever is queued, or running with its lease run out). A job whose time
 * runs out goes back to `queued`; Vertex trouble or the budget pauses it with
 * the code, keeping what it wrote; an ai_failed document is tried once more
 * before the job pauses.
 */
export async function runTranslationJobs(pool: Pool, opts: RunOptions): Promise<RunReport> {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.budgetMs - MARGIN_MS;
  const report: RunReport = { jobs: 0, docs: 0 };
  // Read at each run, uncached: a feature switched off or a new budget applies at once.
  const { settings } = await loadAiSettings(pool);
  while (now() < deadline) {
    const job = await claimJob(pool, { ids: opts.ids });
    if (!job) break;
    report.jobs += 1;
    report.docs += await runJob(pool, job, settings, deadline, now);
  }
  return report;
}

async function runJob(pool: Pool, job: ClaimedJob, settings: AiSettings, deadline: number, now: () => number): Promise<number> {
  const progress: JobProgress = job.progress;
  const retried = new Set<string>();
  let docs = 0;
  for (;;) {
    const scan = await missingDocs(pool, job.locale, BATCH, new Set(progress.skipped));
    progress.remaining = scan.remaining;
    if (scan.docs.length === 0) {
      await endRun(pool, job, { status: 'done' }, progress);
      return docs;
    }
    for (const doc of scan.docs) {
      if (now() >= deadline) {
        await endRun(pool, job, { status: 'queued' }, progress);
        return docs;
      }
      // Renews the lease; false: cancelled, or another run holds the job now.
      if (!(await saveProgress(pool, job, progress))) return docs;
      const units = docUnits(doc);
      let out: { results: Translated[]; model: ModelId };
      try {
        out = await translateItems(pool, { items: doc.items, locale: job.locale, actorId: null, jobId: job.id, settings });
      } catch (err) {
        const code = vertexErrorCode(err);
        if (code === 'ai_failed' && !retried.has(units[0])) {
          // Once more in this run: the document is still missing, so the next scan brings it back first.
          retried.add(units[0]);
          continue;
        }
        await endRun(pool, job, { status: 'paused', error: code }, progress);
        return docs;
      }
      docs += 1;
      let w: Written;
      try {
        w = doc.type === 'item' ? await writeItemDoc(pool, doc, job.locale, out.results, out.model) : await writeStringsDoc(pool, doc, job.locale, out.results, out.model);
      } catch (err) {
        console.error('[ai] job write failed', { job: job.id, code: (err as { code?: string } | null)?.code ?? 'unknown' });
        await endRun(pool, job, { status: 'paused', error: 'db_error' }, progress);
        return docs;
      }
      progress.done += w.written.length;
      for (const u of w.written) delete progress.strikes[u];
      for (const u of w.failed) strike(progress, u);
      progress.remaining = Math.max(0, (progress.remaining ?? 0) - w.written.length);
    }
  }
}

/** For after(): never throws (a run that cannot finish leaves its lease to run out, and the cron goes on). */
export async function runTranslationJobsQuietly(pool: Pool, opts: RunOptions): Promise<void> {
  try {
    await runTranslationJobs(pool, opts);
  } catch (err) {
    console.error('[ai] job run failed', { code: (err as { code?: string } | null)?.code ?? 'unknown', name: err instanceof Error ? err.name : typeof err });
  }
}
