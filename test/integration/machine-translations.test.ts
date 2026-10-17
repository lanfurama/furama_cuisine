import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPool, query } from '@/db/client';
import { AiSettingsSchema } from '@/lib/admin/ai-schemas';
import { REGISTRY, type StringKey } from '@/lib/i18n/registry';
import { sourceHash } from '@/lib/i18n/source-hash';
import { AGREED_KEYS } from '@/lib/legal';
import type { AuditActor } from '@/lib/server/audit';
import { resetFake } from '@/lib/server/ai/fake';
import { ceilingUsd } from '@/lib/server/ai/guard';
import { cancelJob, createJob, jobById, resumeJob } from '@/lib/server/ai/jobs';
import { priceUsd } from '@/lib/server/ai/models';
import { MAX_CHARS } from '@/lib/server/ai/translate';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { missingDocs, runTranslationJobs } from '@/lib/server/content-admin/machine-translations';
import { getOfferEditor, updateOffer } from '@/lib/server/content-admin/offers';
import { coverage, reviewQueue } from '@/lib/server/content-admin/translations';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 9 D8 (spec §9.3, R9-9, R9-17 … R9-20, Review Focus 1 and 5): a bulk
 * job translates what is missing in a language through the fake model
 * (AI_PROVIDER=fake: «vi» + the English), writes machine rows into empty
 * places only, each with its audit row, pauses on Vertex trouble or the
 * budget and resumes where it stopped, and is picked up again when the
 * function holding it died. `translateItems` is wrapped so a test can act
 * between the scan and the write.
 */

const hook = vi.hoisted(() => ({ calls: 0, before: null as null | ((call: number, ids: string[]) => Promise<void>) }));
vi.mock('@/lib/server/ai/translate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/server/ai/translate')>();
  return {
    ...orig,
    translateItems: async (...args: Parameters<typeof orig.translateItems>) => {
      hook.calls += 1;
      await hook.before?.(hook.calls, args[1].items.map((i) => i.id));
      return orig.translateItems(...args);
    },
  };
});

const pool = getPool();
const ADMIN: AuditActor = { id: 'staff-d8-run', email: 'run-d8@furama.test', name: 'Minh' };
const I18N = ['offer_i18n', 'cuisine_i18n', 'destination_i18n', 'experience_i18n', 'story_i18n', 'nav_item_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n', 'media_i18n', 'closure_i18n'];
const MODEL = AiSettingsSchema.parse({}).features.translate.model;
const BIG = 600_000;

async function cleanUp() {
  for (const t of I18N) await query(`DELETE FROM ${t} WHERE locale = 'vi'`);
  await query(`DELETE FROM content_strings WHERE locale = 'vi'`);
  await query(`DELETE FROM audit_log WHERE entity_type = 'ai_jobs' OR after->'meta' ? 'machine' OR actor_id = $1`, [ADMIN.id]);
  await query('TRUNCATE ai_jobs, ai_usage CASCADE');
  await query('TRUNCATE ai_glossary');
  await setAiSettings({});
}

/** The AI configuration the job reads, by upsert: the row may be gone (an earlier file's TRUNCATE staff_user … CASCADE). */
async function setAiSettings(data: object) {
  await query(`INSERT INTO ai_settings (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify(data)]);
}

const newJob = async () => ((await createJob(pool, ADMIN, 'vi')) as { ok: true; data: { id: string } }).data.id;
const offerVi = async (id: number) => (await query(`SELECT title, status, origin, ai_model, source_hash, reviewed_by FROM offer_i18n WHERE offer_id = $1 AND locale = 'vi'`, [id]))[0];
const machineRows = async () => {
  let n = 0;
  for (const t of I18N) n += (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE locale = 'vi' AND status = 'machine'`))[0].n;
  return n + (await query<{ n: number }>(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'vi' AND status = 'machine'`))[0].n;
};
const machineAudits = async () => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE after->'meta' ? 'machine'`))[0].n;

describe.skipIf(!TEST_DATABASE_URL)('bulk machine translation (database)', () => {
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    resetFake();
    hook.calls = 0;
    hook.before = null;
    await cleanUp();
    await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'admin') ON CONFLICT (id) DO NOTHING`, [ADMIN.id, ADMIN.name, ADMIN.email]);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    resetFake();
    await cleanUp();
    await query(`DELETE FROM staff_user WHERE id = $1`, [ADMIN.id]);
  });

  it('lists what is missing: never policy or consent text, never decorative pictures or PDFs, never closure reasons, never the registry’s own Vietnamese', async () => {
    const { docs, remaining } = await missingDocs(pool, 'vi', 10_000);
    const ids = docs.flatMap((d) => (d.type === 'item' ? [`${d.kind.key}#${d.id}`] : d.items.map((i) => `${d.kind.key}#${i.id}`)));
    expect(remaining).toBe(ids.length);
    for (const k of AGREED_KEYS) expect(ids.some((u) => u.endsWith(`#${k}`))).toBe(false);
    expect(ids.some((u) => u.startsWith('closure#'))).toBe(false);
    expect(ids.some((u) => /#email\./.test(u))).toBe(false); // email.* has the registry's Vietnamese
    const media = docs.filter((d) => d.type === 'item' && d.kind.key === 'media').map((d) => (d as { id: string }).id);
    expect(media.length).toBeGreaterThan(0);
    const shown = await query<{ id: string }>(`SELECT id::text FROM media WHERE id = ANY($1::uuid[]) AND (is_decorative OR content_type = 'application/pdf')`, [media]);
    expect(shown).toEqual([]);
    // Each document is one call's worth: at most 20 items, a strings document of one screen.
    expect(docs.every((d) => d.items.length >= 1 && d.items.length <= 20)).toBe(true);
    // An item document translates words only, with the column's length limit.
    const restaurants = docs.filter((d) => d.type === 'item' && d.kind.key === 'restaurants').flatMap((d) => d.items);
    expect(restaurants.map((i) => i.id)).not.toContain('menu_pdf_url');
    expect(restaurants.find((i) => i.id === 'story')).toMatchObject({ maxLength: 1500 });
    // The order is stable: the coverage screen's kinds first to last.
    expect(docs[0]).toMatchObject({ type: 'item', id: '1' });
    expect((await missingDocs(pool, 'vi', 3)).docs.map((d) => d.items)).toEqual(docs.slice(0, 3).map((d) => d.items));
  });

  it('runs a job to done: machine rows only, each with its audit row; reviewers see them, guests do not', async () => {
    const id = await newJob();
    const report = await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const job = (await jobById(pool, id))!;
    expect(job).toMatchObject({ status: 'done', error: null, progress: { remaining: 0 } });
    expect(report).toMatchObject({ jobs: 1 });
    // The fake's «vi» prefix runs a short key past its limit: refused three times, then skipped, still missing.
    expect(job.progress.failed).toBe(job.progress.skipped.length * 3);
    expect((await missingDocs(pool, 'vi', 1)).remaining).toBe(job.progress.skipped.length);

    const english = (await query<{ title: string; schedule: string | null; venue_override: string | null }>(`SELECT title, schedule, venue_override FROM offer_i18n WHERE offer_id = 1 AND locale = 'en'`))[0];
    expect(await offerVi(1)).toEqual({
      title: `«vi» ${english.title}`,
      status: 'machine',
      origin: 'ai',
      ai_model: MODEL,
      source_hash: sourceHash(['title', 'schedule', 'venue_override'], english),
      reviewed_by: null,
    });
    expect(job.progress.done).toBe(await machineRows());
    expect(await query(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'vi' AND status <> 'machine'`)).toEqual([{ n: 0 }]);

    // R9-20 (as corrected): update for an item, create for a key, no actor, the model in after.meta; audit_log's CHECK takes them.
    expect(await machineAudits()).toBe(job.progress.done);
    const audits = await query<{ action: string; actor_id: string | null; entity_type: string; locale: string; model: string }>(
      `SELECT action, actor_id, entity_type, locale, after->'meta'->'machine'->>'model' AS model FROM audit_log WHERE after->'meta' ? 'machine'`,
    );
    expect(new Set(audits.map((a) => `${a.entity_type}:${a.action}`))).toEqual(
      new Set(['offers:update', 'cuisines:update', 'destinations:update', 'experiences:update', 'stories:update', 'nav_items:update', 'restaurants:update', 'media:update', 'content_strings:create']),
    );
    expect(audits.every((a) => a.actor_id === null && a.locale === 'vi' && a.model === MODEL)).toBe(true);
    const offerAudit = (await query<{ after: { v: number; i18n: { locale: string; status: string }[] } }>(`SELECT after FROM audit_log WHERE entity_type = 'offers' AND entity_id = '1' AND after->'meta' ? 'machine'`))[0];
    expect(offerAudit.after.v).toBe(1);
    expect(offerAudit.after.i18n.find((t) => t.locale === 'vi')).toMatchObject({ status: 'machine' });

    // The calls: not counted per person, tied to the job.
    expect(await query(`SELECT DISTINCT actor_id, job_id::text, feature, status FROM ai_usage`)).toEqual([{ actor_id: null, job_id: id, feature: 'translate', status: 'ok' }]);

    // The coverage screen agrees, and the queue lists them for review.
    const cover = await coverage(pool);
    const offers = cover.kinds.find((k) => k.key === 'offers')!.cells.vi;
    expect(offers).toMatchObject({ missing: 0, machine: offers.total, stale: 0 });
    expect((await reviewQueue(pool, { locale: 'vi', kind: 'offers' })).items.map((i) => i.reason)).toEqual(['machine', 'machine', 'machine']);

    // Guests read reviewed translations only (lib/server/content/strings.queries.ts).
    const key = (await query<{ key: StringKey }>(`SELECT key FROM content_strings WHERE locale = 'vi' LIMIT 1`))[0].key;
    expect((await loadStringRows('vi', [key])).rows.filter((r) => r.locale === 'vi')).toEqual([]);
  });

  it('never overwrites a row written after the scan, nor a machine row already there, nor follows English that changed', async () => {
    await query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model) VALUES (2, 'vi', 'Máy cũ', 'machine', 'ai', 'older')`);
    const seeded = (await query<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 3 AND locale = 'en'`))[0].title;
    const editor = (await getOfferEditor(pool, '1'))!;
    hook.before = async (call) => {
      if (call !== 1) return;
      // Between the scan and the write of offer 1: an Editor saves its Vietnamese, and someone edits offer 3's English.
      await updateOffer(pool, ADMIN, '1', editor.token, { ...editor.values, title: { ...editor.values.title, vi: 'Của Editor' } });
      await query(`UPDATE offer_i18n SET title = 'Sunset Cocktails, renamed' WHERE offer_id = 3 AND locale = 'en'`);
    };
    try {
      const id = await newJob();
      await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
      expect(await jobById(pool, id)).toMatchObject({ status: 'done' });
      expect(await offerVi(1)).toMatchObject({ title: 'Của Editor', status: 'reviewed', origin: 'human' });
      expect(await offerVi(2)).toMatchObject({ title: 'Máy cũ', ai_model: 'older' });
      // Offer 3 was translated once more, from its new English.
      expect(await offerVi(3)).toMatchObject({ title: '«vi» Sunset Cocktails, renamed', status: 'machine' });
      expect(await query(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'offers' AND entity_id IN ('1', '2') AND after->'meta' ? 'machine'`)).toEqual([{ n: 0 }]);
    } finally {
      // Later files read the seed's English.
      await query(`UPDATE offer_i18n SET title = $1 WHERE offer_id = 3 AND locale = 'en'`, [seeded]);
    }
  });

  it('pauses on Vertex trouble (429 on the 7th call: ai_quota), keeps the six before, and "Tiếp tục" goes on from there', async () => {
    vi.stubEnv('AI_FAKE_FAIL', 'translate:429@7');
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const paused = (await jobById(pool, id))!;
    expect(paused).toMatchObject({ status: 'paused', error: 'ai_quota' });
    expect(await query(`SELECT status, count(*)::int AS n FROM ai_usage GROUP BY status ORDER BY status`)).toEqual([
      { status: 'error', n: 1 },
      { status: 'ok', n: 6 },
    ]);
    const kept = await query(`SELECT offer_id, title, updated_at FROM offer_i18n WHERE locale = 'vi' ORDER BY offer_id`);
    expect(kept).toHaveLength(3);
    expect(paused.progress.done).toBe(await machineRows());
    expect(paused.progress.done).toBeGreaterThan(0);
    // Paused, the job waits for a person: a run claims nothing.
    expect(await runTranslationJobs(pool, { budgetMs: BIG })).toEqual({ jobs: 0, docs: 0 });

    vi.stubEnv('AI_FAKE_FAIL', '');
    expect(await resumeJob(pool, ADMIN, id)).toEqual({ ok: true, data: null });
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const done = (await jobById(pool, id))!;
    expect(done).toMatchObject({ status: 'done', error: null, progress: { remaining: 0 } });
    expect(await query(`SELECT offer_id, title, updated_at FROM offer_i18n WHERE locale = 'vi' ORDER BY offer_id`)).toEqual(kept);
    expect(done.progress.done).toBe(await machineRows());
  });

  it('pauses when the budget runs out (ai_budget) and keeps what it wrote', async () => {
    // An earlier file's TRUNCATE staff_user … CASCADE takes the ai_settings row with it (its updated_by points
    // there), and an UPDATE of no row left the default $20 in force (CI, PR #23): the budget is written by upsert.
    await query('DELETE FROM ai_settings');
    const cfg = AiSettingsSchema.parse({}).features.translate;
    // Room for the first call whatever its size (its text is at most MAX_CHARS, plus the instructions), then for
    // three of the fake's calls (100 tokens in, 50 out) more: of the dozens of documents, a few are translated.
    const first = ceilingUsd({ feature: 'translate', model: cfg.model, region: cfg.region, actorId: null, inputChars: 2 * MAX_CHARS, maxOutputTokens: cfg.maxOutputTokens });
    const budgetUsd = Number((first + 3 * priceUsd(cfg.model, cfg.region, 100, 50)).toFixed(6));
    await setAiSettings({ budgetUsd });
    expect(await query(`SELECT data FROM ai_settings WHERE id = 1`)).toEqual([{ data: { budgetUsd } }]);
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const paused = (await jobById(pool, id))!;
    expect(paused).toMatchObject({ status: 'paused', error: 'ai_budget' });
    expect(paused.progress.done).toBeGreaterThan(0);
    expect(paused.progress.remaining).toBeGreaterThan(0);
    expect(await machineRows()).toBe(paused.progress.done);
    // The refused call left no row: every call that ran was settled.
    expect(await query(`SELECT DISTINCT status FROM ai_usage`)).toEqual([{ status: 'ok' }]);

    await setAiSettings({});
    await resumeJob(pool, ADMIN, id);
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    expect(await jobById(pool, id)).toMatchObject({ status: 'done' });
  });

  it('claims a job whose lease ran out (a dead function) and finishes it', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ai_jobs (locale, status, attempts, locked_until, progress) VALUES ('vi', 'running', 1, now() - interval '1 minute', '{"done":0,"failed":0,"remaining":5}') RETURNING id::text`,
    );
    // The cron's run: no ids.
    expect(await runTranslationJobs(pool, { budgetMs: BIG })).toMatchObject({ jobs: 1 });
    expect(await jobById(pool, rows[0].id)).toMatchObject({ status: 'done', progress: { remaining: 0 } });
    // A live lease is left alone.
    await cleanUp();
    await pool.query(`INSERT INTO ai_jobs (locale, status, attempts, locked_until) VALUES ('vi', 'running', 1, now() + interval '4 minutes')`);
    expect(await runTranslationJobs(pool, { budgetMs: BIG })).toEqual({ jobs: 0, docs: 0 });
  });

  it('when its time runs out, a job goes back to queued with its lease cleared (R9-16)', async () => {
    let clock = 0;
    hook.before = async (call) => {
      if (call === 3) clock = 1e12;
    };
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: 60_000, ids: [id], now: () => clock });
    const job = (await jobById(pool, id))!;
    expect(job).toMatchObject({ status: 'queued', error: null });
    expect(job.progress.done).toBe(await machineRows());
    expect(await query(`SELECT count(*)::int AS n FROM ai_usage`)).toEqual([{ n: 3 }]);
    expect(await query(`SELECT locked_until FROM ai_jobs WHERE id = $1`, [id])).toEqual([{ locked_until: null }]);
  });

  it('cancel stops a job in flight; a cancelled job never runs again', async () => {
    const id = await newJob();
    hook.before = async (call) => {
      if (call === 2) await cancelJob(pool, ADMIN, id);
    };
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    expect(await jobById(pool, id)).toMatchObject({ status: 'cancelled' });
    expect(hook.calls).toBe(2);
    expect(await runTranslationJobs(pool, { budgetMs: BIG })).toEqual({ jobs: 0, docs: 0 });
  });

  it('a unit the model keeps getting wrong (a lost name) is skipped after three tries; the rest finishes', async () => {
    await query(`INSERT INTO ai_glossary (term, mode) VALUES ('Danang', 'keep'), ('Da Nang', 'keep'), ('Furama', 'keep')`);
    vi.stubEnv('AI_FAKE_DROP_TOKEN', '1');
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const job = (await jobById(pool, id))!;
    expect(job.status).toBe('done');
    expect(job.progress.skipped.length).toBeGreaterThan(0);
    expect(job.progress.failed).toBe(job.progress.skipped.length * 3);
    expect(job.progress.remaining).toBe(0);
    // The skipped places are still missing; nothing broken was written.
    expect((await missingDocs(pool, 'vi', 10_000)).remaining).toBe(job.progress.skipped.length);
    expect(await query(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'vi' AND value LIKE '%⟦%'`)).toEqual([{ n: 0 }]);
  });

  it('a form opened before the job wrote its language gets a conflict, as for any other write (R9-20)', async () => {
    const editor = (await getOfferEditor(pool, '1'))!;
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const result = await updateOffer(pool, ADMIN, '1', editor.token, { ...editor.values, title: { ...editor.values.title, vi: 'Muộn' } });
    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await offerVi(1)).toMatchObject({ status: 'machine' });
  });

  it('a machine string passes the editor’s own checks: ICU variables kept', async () => {
    const id = await newJob();
    await runTranslationJobs(pool, { budgetMs: BIG, ids: [id] });
    const row = (await query<{ value: string }>(`SELECT value FROM content_strings WHERE key = 'error.party_too_large' AND locale = 'vi'`))[0];
    expect(row.value).toBe(`«vi» ${REGISTRY['error.party_too_large'].en}`);
  });
});
