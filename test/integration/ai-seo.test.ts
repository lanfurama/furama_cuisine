import { MockLanguageModelV4 } from 'ai/test';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { REGISTRY } from '@/lib/i18n/registry';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 9 D10 (spec §9.3, R9-17, R9-22): the CMS gathers what a page says
 * (seo-material.ts, as guests read it in the language, else English, never
 * guest data), and the gate words it (ai/seo.ts): names masked and given back
 * exactly, 60/155 characters at a word boundary, one ai_usage row 'seo' for
 * the person who pressed, under the budget and their limits. Nothing is saved.
 */

let settings: AiSettings;
vi.mock('@/lib/server/ai/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/server/ai/settings')>()), cachedAiSettings: async () => settings }));

import { seoMaterial } from '@/lib/server/content-admin/seo-material';
import { suggestSeo, type SeoMaterial } from '@/lib/server/ai/seo';

const STAFF = 'staff-d10-seo';
const GUEST = 'Bí Mật D10 Guest';
let pool: Pool;

const usage = async () =>
  (await pool.query<{ feature: string; actor_id: string | null; status: string }>(`SELECT feature, actor_id, status FROM ai_usage ORDER BY id`)).rows;
const failures = async () =>
  (await pool.query(`SELECT feature, actor_id, status, error_code, output_tokens FROM ai_usage ORDER BY id`)).rows;
const field = (m: SeoMaterial | null, label: string) => m?.fields.find((f) => f.label === label)?.text;

/** A model that answers one fixed JSON object, and keeps what it was sent. */
function answering(answer: { title: string; description: string }) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
const promptOf = (model: MockLanguageModelV4) => {
  const prompt = model.doGenerateCalls[0].prompt;
  const text = (role: string) =>
    prompt
      .filter((m) => m.role === role)
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : '')).join('')))
      .join('\n');
  return { instructions: text('system'), user: text('user') };
};

async function cleanUp() {
  await pool.query('TRUNCATE ai_usage, ai_glossary');
  await pool.query(`DELETE FROM restaurant_i18n WHERE locale = 'vi' AND restaurant_id = 'taya-house'`);
  await pool.query(`DELETE FROM content_strings WHERE locale = 'vi' AND key = 'hero.lede'`);
  await pool.query(`DELETE FROM reservations WHERE guest_name = $1`, [GUEST]);
  await pool.query(`UPDATE restaurants SET is_published = true WHERE id = 'pho-cuon'`);
}

describe.skipIf(!TEST_DATABASE_URL)('SEO suggestions (database)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`, [STAFF]);
  });
  afterAll(async () => {
    await cleanUp();
    await pool.query(`DELETE FROM staff_user WHERE id = $1`, [STAFF]);
    await pool.end();
  });
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    settings = AiSettingsSchema.parse({});
    await cleanUp();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('seoMaterial (lib/server/content-admin/seo-material.ts)', () => {
    it('a restaurant: its name, type, destination, cuisines, story and current SEO, in English', async () => {
      const m = await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'en');
      expect(m?.page).toBe('restaurant');
      expect(field(m, 'Name')).toBe('Tàya House');
      expect(field(m, 'Type')).toBe('Vietnamese · Cooking Class');
      expect(field(m, 'Destination')).toBe('Furama Resort Danang');
      expect(field(m, 'Cuisines')).toBe('Vietnamese');
      expect(field(m, 'Story')).toMatch(/^Beneath the Lagoon Garden/);
      expect(field(m, 'Current SEO title')).toBe('Tàya House — Furama Cuisine');
    });

    it('in the target language where a reviewed translation exists, else English; a machine row is not used', async () => {
      await pool.query(`INSERT INTO restaurant_i18n (restaurant_id, locale, story, status, origin) VALUES ('taya-house', 'vi', 'Câu chuyện đã duyệt của Tàya House.', 'reviewed', 'human')`);
      const reviewed = await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'vi');
      expect(field(reviewed, 'Story')).toBe('Câu chuyện đã duyệt của Tàya House.');
      expect(field(reviewed, 'Type')).toBe('Vietnamese · Cooking Class');
      await pool.query(`UPDATE restaurant_i18n SET status = 'machine', origin = 'ai' WHERE restaurant_id = 'taya-house' AND locale = 'vi'`);
      expect(field(await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'vi'), 'Story')).toMatch(/^Beneath the Lagoon Garden/);
    });

    it('no such restaurant: null', async () => {
      expect(await seoMaterial(pool, { kind: 'restaurant', id: 'no-such-place' }, 'en')).toBeNull();
    });

    it('the home page: the hero, the destinations, the shown restaurants by name, the current title, in the language', async () => {
      await pool.query(`UPDATE restaurants SET is_published = false WHERE id = 'pho-cuon'`);
      await pool.query(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ('hero.lede', 'vi', 'Lời dẫn tiếng Việt.', 'reviewed', 'human')`);
      const m = await seoMaterial(pool, { kind: 'home' }, 'vi');
      expect(m?.page).toBe('home');
      expect(field(m, 'Hero text')).toBe('Lời dẫn tiếng Việt.');
      expect(field(m, 'Restaurants')).toContain('Tàya House (Vietnamese · Cooking Class)');
      expect(field(m, 'Restaurants')).toContain('Hải Vân Lounge');
      expect(field(m, 'Restaurants')).not.toContain('Phố Cuốn');
      expect(field(m, 'Destinations')).toContain('Furama Resort Danang');
      expect(field(m, 'Current title')).toBe(REGISTRY['seo.home_title'].en);
    });

    it('never carries guest data (spec §9.4)', async () => {
      await pool.query(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note, meal, source)
         VALUES ('D10SEO1', 'taya-house', current_date + 3, '19:00', 2, $1, '0905 000 111', '+84905000111', 'd10-guest@example.test', 'd10 secret note', 'Dinner', 'web')`,
        [GUEST],
      );
      const all = JSON.stringify([await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'en'), await seoMaterial(pool, { kind: 'home' }, 'en')]);
      for (const secret of [GUEST, '0905 000 111', '+84905000111', 'd10-guest@example.test', 'd10 secret note', 'D10SEO1']) expect(all).not.toContain(secret);
    });
  });

  describe('suggestSeo (lib/server/ai/seo.ts)', () => {
    it('suggests a title and a description in the language, the name kept, within 60/155, with one seo usage row for the person', async () => {
      const material = (await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'vi'))!;
      const s = await suggestSeo(pool, { material, locale: 'vi', actorId: STAFF });
      expect(s.title).toBe('«vi» Tàya House — fake SEO title');
      expect(s.description).toMatch(/^«vi» A fake description of this page/);
      expect([...s.title].length).toBeLessThanOrEqual(60);
      expect([...s.description].length).toBeLessThanOrEqual(155);
      expect(s.description).not.toMatch(/[\s\p{P}]$/u);
      expect(await usage()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'ok' }]);
    });

    it('sends the material with names masked, the language, the brand voice and the system prompt; the answer gets the names back whole', async () => {
      settings = AiSettingsSchema.parse({ brandVoice: 'Warm, unhurried.', features: { seo: { systemPrompt: 'Mention the sea when the page does.' } } });
      await pool.query(`INSERT INTO ai_glossary (term, mode) VALUES ('Lagoon Garden', 'keep')`);
      const model = answering({ title: '⟦G1⟧ in the ⟦G2⟧ of the resort: Vietnamese cooking', description: 'Cook with herbs from the ⟦G2⟧ at ⟦G1⟧.' });
      const material = (await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'vi'))!;
      const s = await suggestSeo(pool, { material, locale: 'vi', actorId: STAFF }, { model });
      const { instructions, user } = promptOf(model);
      expect(instructions.split('\n').slice(0, 2)).toEqual(['TASK: seo', 'TARGET: vi']);
      expect(instructions).toContain('in Vietnamese');
      expect(instructions).toContain('Brand voice: Warm, unhurried.');
      expect(instructions).toContain('Mention the sea when the page does.');
      expect(user).toContain('Name: ⟦G1⟧');
      expect(user).toContain('Furama Resort Danang');
      expect(user).not.toContain('Tàya House');
      expect(user).not.toContain('Lagoon Garden');
      // The title passes 60: cut at a word boundary, and never inside a name.
      expect(s.title).toBe('Tàya House in the Lagoon Garden of the resort: Vietnamese');
      expect(s.description).toBe('Cook with herbs from the Lagoon Garden at Tàya House.');
    });

    it('cuts before a name rather than through it', async () => {
      const model = answering({ title: 'Plant-forward Vietnamese cooking classes and dinners at ⟦G1⟧', description: 'At ⟦G1⟧.' });
      const material = (await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'en'))!;
      const s = await suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model });
      expect(s.title).toBe('Plant-forward Vietnamese cooking classes and dinners at');
    });

    it('refuses an answer with a token it was not given, or a look-alike (ai_placeholder): one ledger row, an error with that code, its tokens billed', async () => {
      const material = (await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'en'))!;
      for (const title of ['⟦G9⟧ — dinner', '〚G1〛 — dinner']) {
        await pool.query('TRUNCATE ai_usage');
        await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model: answering({ title, description: 'Fine.' }) })).rejects.toMatchObject({
          code: 'ai_placeholder',
        });
        expect(await failures()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'error', error_code: 'ai_placeholder', output_tokens: 10 }]);
      }
    });

    it('an answer past the registry maximum (70/200) is cut, not refused: Claude on Vertex does not hold the schema to maxLength', async () => {
      const long = 'Vietnamese plant-forward cooking classes and slow dinners by the lagoon';
      expect(long.length).toBeGreaterThan(REGISTRY['seo.home_title'].maxLength);
      const description = 'Long lunches in a quiet garden. '.repeat(7).trim();
      expect(description.length).toBeGreaterThan(REGISTRY['seo.home_description'].maxLength);
      const material = (await seoMaterial(pool, { kind: 'home' }, 'en'))!;
      const s = await suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model: answering({ title: long, description }) });
      expect(s.title).toBe('Vietnamese plant-forward cooking classes and slow dinners by');
      expect([...s.description].length).toBeLessThanOrEqual(155);
      expect(await usage()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'ok' }]);
    });

    it('a runaway answer (past 300/600) is a failed call, billed as an error', async () => {
      const model = answering({ title: 'x '.repeat(200), description: 'Fine.' });
      const material = (await seoMaterial(pool, { kind: 'home' }, 'en'))!;
      await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model })).rejects.toMatchObject({ code: 'ai_failed' });
      expect(await usage()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'error' }]);
    });

    it('a title or a description with no letter or digit, or nothing left once cleaned, is ai_failed (one error row)', async () => {
      const material = (await seoMaterial(pool, { kind: 'home' }, 'en'))!;
      for (const answer of [{ title: '—', description: 'Fine dining.' }, { title: 'Fine dining', description: '… !' }, { title: '\u200B\u0007', description: 'Fine.' }]) {
        await pool.query('TRUNCATE ai_usage');
        await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model: answering(answer) }), JSON.stringify(answer)).rejects.toMatchObject({ code: 'ai_failed' });
        expect(await failures()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'error', error_code: 'ai_failed', output_tokens: 10 }]);
      }
    });

    it('strips control and invisible characters before the form gets them', async () => {
      const material = (await seoMaterial(pool, { kind: 'restaurant', id: 'taya-house' }, 'en'))!;
      const s = await suggestSeo(pool, { material, locale: 'en', actorId: STAFF }, { model: answering({ title: '⟦G1⟧\u202E\u0000 by the\u200B sea', description: 'Fine\u0007 dining.' }) });
      expect(s).toEqual({ title: 'Tàya House by the sea', description: 'Fine dining.' });
    });

    it('goes through the guard: the feature off, the budget spent, the per-person limit', async () => {
      const material = (await seoMaterial(pool, { kind: 'home' }, 'en'))!;
      settings = AiSettingsSchema.parse({ features: { seo: { enabled: false } } });
      await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF })).rejects.toMatchObject({ code: 'ai_off' });
      settings = AiSettingsSchema.parse({ budgetUsd: 0 });
      await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF })).rejects.toMatchObject({ code: 'ai_budget' });
      expect(await usage()).toEqual([]);
      settings = AiSettingsSchema.parse({ limits: { perMinute: 1 } });
      await suggestSeo(pool, { material, locale: 'en', actorId: STAFF });
      await expect(suggestSeo(pool, { material, locale: 'en', actorId: STAFF })).rejects.toMatchObject({ code: 'ai_rate_minute' });
      expect(await usage()).toEqual([{ feature: 'seo', actor_id: STAFF, status: 'ok' }]);
    });
  });
});
