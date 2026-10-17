import sharp from 'sharp';
import { getGlobalDispatcher } from 'undici';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPool, query } from '@/db/client';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { tagsForSave } from '@/lib/cache-plan';
import { describeImage } from '@/lib/server/ai/alt';
import { fakeModel, resetFake, setFakeFlags } from '@/lib/server/ai/fake';
import { describeMediaImage, generateAltQuietly } from '@/lib/server/content-admin/machine-alt';
import { getMedia, imageForAi, MEDIA, saveMediaDetails, writeMachineAlt } from '@/lib/server/media/library';
import { registerUploadedMedia } from '@/lib/server/media/register';
import { installBlobRedirect, refused } from '../helpers/blob-redirect.mjs';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startFakeBlob, type FakeBlob } from '../helpers/fake-blob';

/*
 * Phase 9 D11 (spec §9.3, R9-12 as R9-17 and R9-21 correct it): alt text an
 * AI writes for a picture in Vercel Blob, through the fake model and the fake
 * store (never Vertex, never the real Blob service).
 *
 *  - After an upload, registerMediaAction runs generateAltQuietly in after():
 *    EN alt with status 'machine', origin 'ai', only into an empty place, one
 *    audit row (action update, actor NULL, after.meta.machine). Not counted per
 *    person (actor_id NULL), counted in the budget. Never in a Draft Mode
 *    preview; never for a PDF, a decorative picture, a file in the trash or
 *    a static one; never failing the upload.
 *  - "Viết alt bằng AI": POST /api/admin/ai/alt answers the text and writes
 *    nothing; counted per person.
 *
 * requirePermission keeps its real rule (roleCan) on a role the test picks.
 */

const state = vi.hoisted(() => ({
  role: null as null | 'admin' | 'editor',
  draft: false,
  settings: null as unknown,
  after: [] as (() => unknown)[],
  revalidated: [] as string[],
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (task: () => unknown) => void state.after.push(task) }));
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: state.draft }) }));
vi.mock('next/cache', async (orig) => ({
  ...(await orig<typeof import('next/cache')>()),
  refresh: () => undefined,
  updateTag: () => undefined,
  revalidateTag: (tag: string) => void state.revalidated.push(tag),
}));
vi.mock('@/lib/server/ai/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/server/ai/settings')>()), cachedAiSettings: async () => state.settings as AiSettings }));
vi.mock('@/lib/server/dal/session', async (orig) => {
  const real = await orig<typeof import('@/lib/server/dal/session')>();
  const { roleCan } = await import('@/lib/server/auth/permissions');
  return {
    ...real,
    requirePermission: async (permissions: Parameters<typeof real.requirePermission>[0]) => {
      if (!state.role) throw new real.PermissionError('unauthenticated');
      if (!roleCan(state.role, permissions)) throw new real.PermissionError('forbidden');
      return { userId: `staff-d11-${state.role}`, email: `${state.role}-d11@furama.test`, name: state.role === 'admin' ? 'Hà' : 'Lan', role: state.role, ip: null };
    },
  };
});

import { registerMediaAction } from '@/app/admin/(shell)/media/actions';
import { POST as altRoute } from '@/app/api/admin/ai/alt/route';

const pool = getPool();
const ADMIN = { id: 'staff-d11-admin', email: 'admin-d11@furama.test', name: 'Hà' };
const EDITOR_ID = 'staff-d11-editor';
const FAKE_ALT = 'A fake description of the image.';
const MODEL = AiSettingsSchema.parse({}).features.alt.model;
const ORIGIN = 'http://localhost:3000';
let fake: FakeBlob;
let seq = 0;

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#2f6b4f' } }).jpeg().toBuffer();
/** A pathname of this run in the development folder (lib/media/rules.ts uploadPathname). */
const pathname = (ext: 'jpg' | 'pdf' = 'jpg') => `development/media/${crypto.randomUUID()}/d11-${++seq}.${ext}`;

/** A file put in the fake store and registered as the uploader would; its id. */
async function stored(opts: { w?: number; h?: number; alt?: string; decorative?: boolean } = {}): Promise<string> {
  const p = pathname();
  fake.seed(p, await jpeg(opts.w ?? 64, opts.h ?? 48), 'image/jpeg');
  const reg = await registerUploadedMedia(pool, ADMIN, { pathname: p, alt: opts.alt, decorative: opts.decorative });
  if (!reg.ok) throw new Error(`refused: ${JSON.stringify(reg)}`);
  return reg.data.id;
}

const enAlt = async (id: string) =>
  (await query<{ alt: string; status: string; origin: string; ai_model: string | null; source_hash: string | null; reviewed_by: string | null }>(
    `SELECT alt, status, origin, ai_model, source_hash, reviewed_by FROM media_i18n WHERE media_id = $1 AND locale = 'en'`,
    [id],
  ))[0];
const usage = () => query<{ actor_id: string | null; feature: string; status: string; error_code: string | null }>(`SELECT actor_id, feature, status, error_code FROM ai_usage ORDER BY id`);
const audits = (id: string) =>
  query<{ action: string; actor_id: string | null; after: { meta?: { machine?: { model: string } }; i18n: { locale: string; alt: string }[] } }>(
    `SELECT action, actor_id, after FROM audit_log WHERE entity_type = 'media' AND entity_id = $1 ORDER BY id`,
    [id],
  );
const usageCost = () =>
  query<{ status: string; error_code: string | null; input_tokens: number; output_tokens: number; cost: string }>(
    `SELECT status, error_code, input_tokens, output_tokens, cost_usd::text AS cost FROM ai_usage ORDER BY id`,
  );
/** The fake store's file reads (GET /cdn/…) since the last reset: what downloadBlob fetched. */
const downloads = () => fake.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/cdn/')).length;
const setSettings = (data: unknown) => query(`UPDATE ai_settings SET data = $1::jsonb WHERE id = 1`, [JSON.stringify(data)]);
const staticImage = async () =>
  (await query<{ id: string }>(`SELECT id::text FROM media WHERE storage = 'static' AND content_type <> 'application/pdf' AND deleted_at IS NULL ORDER BY pathname LIMIT 1`))[0].id;
const post = (body: unknown, origin = ORIGIN) =>
  altRoute(new Request(`${ORIGIN}/api/admin/ai/alt`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }));
const runAfter = async () => {
  for (const task of state.after.splice(0)) await task();
};

/** The image part of the first call a mock model received, decoded. */
async function sentImage(model: MockLanguageModelV4) {
  const user = model.doGenerateCalls[0].prompt.find((m) => m.role === 'user')!;
  const part = (user.content as { type: string; mediaType?: string; data?: unknown }[]).find((p) => p.type === 'file')!;
  const raw = part.data as unknown;
  const data = (raw as { type?: string }).type === 'data' ? (raw as { data: unknown }).data : raw;
  const bytes = typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data as Uint8Array);
  return { mediaType: part.mediaType, meta: await sharp(bytes).metadata() };
}

async function cleanUp() {
  await query('TRUNCATE ai_usage, ai_jobs CASCADE');
  await query(`DELETE FROM audit_log WHERE entity_type = 'media' AND (actor_id IS NULL OR actor_id LIKE 'staff-d11-%')`);
  await query(`UPDATE sections SET image_id = NULL WHERE image_id IN (SELECT id FROM media WHERE pathname LIKE 'development/media/%/d11-%')`);
  await query(`DELETE FROM media WHERE pathname LIKE 'development/media/%/d11-%'`);
  await setSettings({});
}

describe.skipIf(!TEST_DATABASE_URL)('alt text by AI (database + fake Blob + fake model)', () => {
  let sectionImage: { key: string; image_id: string | null } | undefined;

  beforeAll(async () => {
    fake = await startFakeBlob();
    const before = getGlobalDispatcher();
    installBlobRedirect(fake.url);
    expect(getGlobalDispatcher()).not.toBe(before);
    process.env.BLOB_READ_WRITE_TOKEN = fake.token;
    process.env.VERCEL_BLOB_RETRIES = '0';
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_ENV;
    for (const [id, role] of [
      [ADMIN.id, 'admin'],
      [EDITOR_ID, 'editor'],
    ]) {
      await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, $2) ON CONFLICT (id) DO NOTHING`, [id, role]);
    }
    sectionImage = (await query<{ key: string; image_id: string | null }>(`SELECT key, image_id::text FROM sections WHERE key = 'experiences'`))[0];
  });

  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    resetFake();
    state.role = 'editor';
    state.draft = false;
    state.settings = AiSettingsSchema.parse({});
    state.after.length = 0;
    state.revalidated.length = 0;
    fake.files.clear();
    await cleanUp();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    resetFake();
    await cleanUp();
    if (sectionImage) await query(`UPDATE sections SET image_id = $2 WHERE key = $1`, [sectionImage.key, sectionImage.image_id]);
    await query(`DELETE FROM staff_user WHERE id IN ($1, $2)`, [ADMIN.id, EDITOR_ID]);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await fake.close();
    expect(refused).toEqual([]);
    await pool.end();
  });

  describe('describeImage (lib/server/ai/alt.ts: bytes in, one sentence out)', () => {
    it('sends one JPEG file part no larger than 1024 px on its long edge, and answers the model’s sentence', async () => {
      const model = fakeModel();
      const out = await describeImage(pool, { bytes: () => jpeg(3000, 2000), actorId: null, settings: AiSettingsSchema.parse({}) }, { model });
      expect(out).toEqual({ alt: FAKE_ALT, model: MODEL });
      const { mediaType, meta } = await sentImage(model);
      expect(mediaType).toBe('image/jpeg');
      expect(meta.format).toBe('jpeg');
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
      expect(await usage()).toEqual([{ actor_id: null, feature: 'alt', status: 'ok', error_code: null }]);
    });

    it('fits a long answer into media_i18n.alt (≤ 250 characters, cut at a word)', async () => {
      const long = Array.from({ length: 70 }, (_, i) => `terrace${i}`).join(' ');
      const model = new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: 'text', text: long }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } },
          warnings: [],
        }),
      });
      const { alt } = await describeImage(pool, { bytes: () => jpeg(40, 30), actorId: null, settings: AiSettingsSchema.parse({}) }, { model });
      expect([...alt].length).toBeLessThanOrEqual(250);
      expect(long.startsWith(`${alt} `)).toBe(true);
    });

    it('a timeout is ai_failed, recorded once as an error', async () => {
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      });
      await expect(describeImage(pool, { bytes: () => jpeg(40, 30), actorId: null, settings: AiSettingsSchema.parse({}) }, { model })).rejects.toMatchObject({
        code: 'ai_failed',
      });
      expect(await usage()).toEqual([{ actor_id: null, feature: 'alt', status: 'error', error_code: 'ai_failed' }]);
    });

    it('an empty answer is one error row, the tokens it used billed', async () => {
      const model = new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: 'text', text: ' \n ' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 7, text: 7, reasoning: undefined } },
          warnings: [],
        }),
      });
      await expect(describeImage(pool, { bytes: () => jpeg(40, 30), actorId: null, settings: AiSettingsSchema.parse({}) }, { model })).rejects.toMatchObject({
        code: 'ai_failed',
      });
      const rows = await usageCost();
      expect(rows).toEqual([{ status: 'error', error_code: 'ai_failed', input_tokens: 120, output_tokens: 7, cost: expect.any(String) }]);
      expect(Number(rows[0].cost)).toBeGreaterThan(0);
    });

    it('bytes that cannot be read or decoded fail inside the reserved call: one error row, cost 0, no model call', async () => {
      const model = fakeModel();
      for (const bytes of [async () => new TextEncoder().encode('not a picture'), async (): Promise<Uint8Array> => Promise.reject(new Error('store down'))]) {
        await expect(describeImage(pool, { bytes, actorId: null, settings: AiSettingsSchema.parse({}) }, { model })).rejects.toMatchObject({ code: 'ai_failed' });
      }
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(await usageCost()).toEqual([
        { status: 'error', error_code: 'ai_failed', input_tokens: 0, output_tokens: 0, cost: '0.000000' },
        { status: 'error', error_code: 'ai_failed', input_tokens: 0, output_tokens: 0, cost: '0.000000' },
      ]);
    });

    it('the alt feature switched off is ai_off, before any call', async () => {
      const settings = AiSettingsSchema.parse({ features: { alt: { enabled: false } } });
      await expect(describeImage(pool, { bytes: () => jpeg(40, 30), actorId: null, settings })).rejects.toMatchObject({ code: 'ai_off' });
      expect(await usage()).toEqual([]);
    });
  });

  describe('imageForAi and writeMachineAlt (lib/server/media/library.ts)', () => {
    it('gives the bytes of a live, non-decorative picture in Blob only: never a static file, a PDF, a decorative picture or one in the trash', async () => {
      const id = await stored();
      const got = await imageForAi(pool, id);
      expect(got?.contentType).toBe('image/jpeg');
      expect((await sharp(Buffer.from(await got!.read())).metadata()).width).toBe(64);

      expect(await imageForAi(pool, await staticImage())).toBeNull();
      expect(await imageForAi(pool, await stored({ decorative: true }))).toBeNull();
      const pdf = pathname('pdf');
      fake.seed(pdf, new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'), 'application/pdf');
      const reg = await registerUploadedMedia(pool, ADMIN, { pathname: pdf });
      expect(reg).toMatchObject({ ok: true, data: { created: true, kind: 'pdf' } });
      expect(await imageForAi(pool, (reg as { data: { id: string } }).data.id)).toBeNull();
      const trashed = await stored();
      await query(`UPDATE media SET deleted_at = now() WHERE id = $1`, [trashed]);
      expect(await imageForAi(pool, trashed)).toBeNull();
      // withoutAlt: only while the default language has no alt.
      expect(await imageForAi(pool, await stored({ alt: 'Written by a person' }), { withoutAlt: true })).toBeNull();
    });

    it('registering answers the kind of file and whether the row is new', async () => {
      const p = pathname();
      fake.seed(p, await jpeg(20, 20), 'image/jpeg');
      expect(await registerUploadedMedia(pool, ADMIN, { pathname: p })).toEqual({ ok: true, data: { id: expect.any(String), created: true, kind: 'image' } });
      expect(await registerUploadedMedia(pool, ADMIN, { pathname: p })).toEqual({ ok: true, data: { id: expect.any(String), created: false, kind: 'image' } });
    });

    it('writes EN alt as machine/ai into an empty place, with its audit row (update, nobody, meta.machine), and says whether the file is shown', async () => {
      const id = await stored();
      expect(await writeMachineAlt(pool, id, 'Prawns on ice', MODEL)).toEqual({ wrote: true, shown: false });
      expect(await enAlt(id)).toEqual({ alt: 'Prawns on ice', status: 'machine', origin: 'ai', ai_model: MODEL, source_hash: null, reviewed_by: null });
      const rows = await audits(id);
      expect(rows.map((r) => [r.action, r.actor_id])).toEqual([
        ['create', ADMIN.id],
        ['update', null],
      ]);
      expect(rows[1].after.meta).toEqual({ machine: { model: MODEL } });
      expect(rows[1].after.i18n).toEqual([expect.objectContaining({ locale: 'en', alt: 'Prawns on ice' })]);

      // A file a section shows: shown, so the caller expires `media`.
      const used = await stored();
      await query(`UPDATE sections SET image_id = $1 WHERE key = 'experiences'`, [used]);
      expect(await writeMachineAlt(pool, used, 'The terrace', MODEL)).toEqual({ wrote: true, shown: true });
    });

    it('never writes over alt text a person wrote, nor on a decorative picture, a PDF or a file in the trash', async () => {
      const id = await stored({ alt: 'Written by a person' });
      expect(await writeMachineAlt(pool, id, 'Machine words', MODEL)).toEqual({ wrote: false, shown: false });
      expect(await enAlt(id)).toMatchObject({ alt: 'Written by a person', status: 'reviewed', origin: 'human' });
      expect((await audits(id)).map((r) => r.action)).toEqual(['create']);

      const decorative = await stored({ decorative: true });
      expect(await writeMachineAlt(pool, decorative, 'Machine words', MODEL)).toEqual({ wrote: false, shown: false });
      const trashed = await stored();
      await query(`UPDATE media SET deleted_at = now() WHERE id = $1`, [trashed]);
      expect(await writeMachineAlt(pool, trashed, 'Machine words', MODEL)).toEqual({ wrote: false, shown: false });
      expect(await query(`SELECT 1 FROM media_i18n WHERE media_id IN ($1, $2)`, [decorative, trashed])).toEqual([]);
    });
  });

  describe('generateAltQuietly (lib/server/content-admin/machine-alt.ts)', () => {
    it('describes a new picture: EN alt machine, the call counted for nobody', async () => {
      const id = await stored({ w: 3000, h: 2000 });
      expect(await generateAltQuietly(pool, id)).toEqual({ wrote: true, shown: false });
      expect(await enAlt(id)).toMatchObject({ alt: FAKE_ALT, status: 'machine', origin: 'ai', ai_model: MODEL });
      expect(await usage()).toEqual([{ actor_id: null, feature: 'alt', status: 'ok', error_code: null }]);
    });

    it('calls no model for a decorative picture, a PDF, a static file, a file in the trash, or one that already has alt', async () => {
      const decorative = await stored({ decorative: true });
      const described = await stored({ alt: 'Written by a person' });
      const trashed = await stored();
      await query(`UPDATE media SET deleted_at = now() WHERE id = $1`, [trashed]);
      const pdf = pathname('pdf');
      fake.seed(pdf, new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'), 'application/pdf');
      const pdfId = ((await registerUploadedMedia(pool, ADMIN, { pathname: pdf })) as { data: { id: string } }).data.id;
      for (const id of [decorative, described, trashed, pdfId, await staticImage()]) expect(await generateAltQuietly(pool, id)).toEqual({ wrote: false, shown: false });
      expect(await usage()).toEqual([]);
      expect(await enAlt(described)).toMatchObject({ alt: 'Written by a person', status: 'reviewed' });
    });

    it('does nothing while AI is not configured or the alt feature is off', async () => {
      const id = await stored();
      vi.stubEnv('AI_PROVIDER', '');
      expect(await generateAltQuietly(pool, id)).toEqual({ wrote: false, shown: false });
      vi.stubEnv('AI_PROVIDER', 'fake');
      await setSettings({ features: { alt: { enabled: false } } });
      expect(await generateAltQuietly(pool, id)).toEqual({ wrote: false, shown: false });
      expect(await usage()).toEqual([]);
      expect(await enAlt(id)).toBeUndefined();
    });

    it('over the budget: logs the code and never throws; the call is not made', async () => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await setSettings({ budgetUsd: 0 });
      const id = await stored();
      fake.requests.length = 0;
      expect(await generateAltQuietly(pool, id)).toEqual({ wrote: false, shown: false });
      // Refused before anything is read from the store (the upload's own measuring read came before).
      expect(downloads()).toBe(0);
      expect(log).toHaveBeenCalledWith('[ai:alt] skipped code=ai_budget');
      expect(await usage()).toEqual([]);
      expect(await enAlt(id)).toBeUndefined();
    });

    it('Vertex refusing (429) or timing out: one error row in ai_usage, no alt, no throw', async () => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setFakeFlags({ fail: 'alt:429' });
      const a = await stored();
      expect(await generateAltQuietly(pool, a)).toEqual({ wrote: false, shown: false });
      expect(log).toHaveBeenCalledWith('[ai:alt] skipped code=ai_quota');
      setFakeFlags({ fail: 'alt:504' });
      const b = await stored();
      expect(await generateAltQuietly(pool, b)).toEqual({ wrote: false, shown: false });
      expect(await usage()).toEqual([
        { actor_id: null, feature: 'alt', status: 'error', error_code: 'ai_quota' },
        { actor_id: null, feature: 'alt', status: 'error', error_code: 'ai_failed' },
      ]);
      expect(await query(`SELECT 1 FROM media_i18n WHERE media_id IN ($1, $2)`, [a, b])).toEqual([]);
    });

    it('a person who saves alt while the model is answering keeps their words (saveMediaDetails, then the machine write)', async () => {
      const id = await stored();
      const token = (await getMedia(pool, id))!.token;
      const described = await describeMediaImage(pool, { mediaId: id, actorId: null, settings: AiSettingsSchema.parse({}), withoutAlt: true });
      expect(described?.alt).toBe(FAKE_ALT);
      expect(await saveMediaDetails(pool, ADMIN, { id, token, alt: 'Typed meanwhile', decorative: false })).toMatchObject({ ok: true });
      expect(await writeMachineAlt(pool, id, described!.alt, described!.model)).toEqual({ wrote: false, shown: false });
      expect(await enAlt(id)).toMatchObject({ alt: 'Typed meanwhile', status: 'reviewed', origin: 'human' });
    });

    it('the AI writing first: a person saving with the token they opened gets conflict, and the AI’s alt stays', async () => {
      const id = await stored();
      const token = (await getMedia(pool, id))!.token;
      expect(await generateAltQuietly(pool, id)).toEqual({ wrote: true, shown: false });
      expect(await saveMediaDetails(pool, ADMIN, { id, token, alt: 'Typed on the old page', decorative: false })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await enAlt(id)).toMatchObject({ alt: FAKE_ALT, status: 'machine', origin: 'ai' });
    });
  });

  describe('registerMediaAction: after() describes a new picture', () => {
    async function upload(ext: 'jpg' | 'pdf' = 'jpg', p = pathname(ext)) {
      if (ext === 'jpg') fake.seed(p, await jpeg(1600, 900), 'image/jpeg');
      else fake.seed(p, new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'), 'application/pdf');
      const res = await registerMediaAction({ pathname: p });
      expect(res).toMatchObject({ ok: true });
      return { id: (res as { data: { id: string } }).data.id, pathname: p };
    }

    it('a new image: one after() task, which writes the machine alt', async () => {
      const { id } = await upload();
      expect(state.after).toHaveLength(1);
      expect(await enAlt(id)).toBeUndefined();
      await runAfter();
      expect(await enAlt(id)).toMatchObject({ alt: FAKE_ALT, status: 'machine', origin: 'ai' });
      expect(await usage()).toEqual([{ actor_id: null, feature: 'alt', status: 'ok', error_code: null }]);
      // Not shown anywhere yet: nothing to expire.
      expect(state.revalidated).toEqual([]);
    });

    it('expires `media` through the cache plan when the file is shown by the time the alt is written', async () => {
      const { id } = await upload();
      await query(`UPDATE sections SET image_id = $1 WHERE key = 'experiences'`, [id]);
      await runAfter();
      expect(state.revalidated.sort()).toEqual([...tagsForSave(MEDIA.tables)].sort());
    });

    it('no after() for a PDF, a re-registered file, or in a Draft Mode preview', async () => {
      await upload('pdf');
      const again = await upload();
      state.after.length = 0;
      await upload('jpg', again.pathname);
      expect(state.after).toEqual([]);
      state.draft = true;
      const { id } = await upload();
      expect(state.after).toEqual([]);
      expect(await enAlt(id)).toBeUndefined();
      expect(await usage()).toEqual([]);
    });

    it('an AI failure never fails the upload', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setFakeFlags({ fail: 'alt:429' });
      const { id } = await upload();
      await expect(runAfter()).resolves.toBeUndefined();
      expect(await query(`SELECT 1 AS ok FROM media WHERE id = $1 AND deleted_at IS NULL`, [id])).toEqual([{ ok: 1 }]);
      expect(await enAlt(id)).toBeUndefined();
      expect(await usage()).toEqual([{ actor_id: null, feature: 'alt', status: 'error', error_code: 'ai_quota' }]);
    });
  });

  describe('POST /api/admin/ai/alt ("Viết alt bằng AI")', () => {
    it('an Editor gets the text; nothing is written, and the call counts for the Editor', async () => {
      const id = await stored({ alt: 'Old words' });
      const res = await post({ mediaId: id });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ alt: FAKE_ALT });
      expect(await enAlt(id)).toMatchObject({ alt: 'Old words', status: 'reviewed' });
      expect(await usage()).toEqual([{ actor_id: EDITOR_ID, feature: 'alt', status: 'ok', error_code: null }]);
    });

    it('the person’s limit applies (R9-3)', async () => {
      state.settings = AiSettingsSchema.parse({ limits: { perMinute: 1 } });
      const id = await stored();
      fake.requests.length = 0;
      expect((await post({ mediaId: id })).status).toBe(200);
      expect(downloads()).toBe(1);
      const second = await post({ mediaId: id });
      expect(second.status).toBe(429);
      expect((await second.json()).code).toBe('ai_rate_minute');
      // The refused click read nothing from the store, and left no ai_usage row.
      expect(downloads()).toBe(1);
      expect(await usage()).toHaveLength(1);
    });

    it('refuses: no session, another site, a preview, the feature off, a bad id, a static, decorative or missing file', async () => {
      const id = await stored();
      state.role = null;
      expect(await (await post({ mediaId: id })).json()).toMatchObject({ code: 'forbidden' });
      state.role = 'editor';
      expect((await post({ mediaId: id }, 'https://evil.example')).status).toBe(403);
      state.draft = true;
      expect(await (await post({ mediaId: id })).json()).toMatchObject({ code: 'ai_preview' });
      state.draft = false;
      state.settings = AiSettingsSchema.parse({ features: { alt: { enabled: false } } });
      expect(await (await post({ mediaId: id })).json()).toMatchObject({ code: 'ai_off' });
      state.settings = AiSettingsSchema.parse({});
      expect((await post({ mediaId: 'nope' })).status).toBe(400);
      for (const target of [await staticImage(), await stored({ decorative: true }), crypto.randomUUID()]) {
        const res = await post({ mediaId: target });
        expect([res.status, (await res.json()).code]).toEqual([404, 'not_found']);
      }
      expect(await usage()).toEqual([]);
    });
  });
});
