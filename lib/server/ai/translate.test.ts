import { MockLanguageModelV4 } from 'ai/test';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';
import { TEST_DATABASE_URL } from '@/test/helpers/db';

let settings: AiSettings;
vi.mock('./settings', () => ({ cachedAiSettings: async () => settings }));

import { translateItems } from './translate';

const STAFF = 'staff-translate';
let pool: Pool;

/** A model that answers with a fixed JSON document. */
const answering = (items: { id: string; text: string }[]) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ items }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });

describe.skipIf(!TEST_DATABASE_URL)('translateItems (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query('TRUNCATE ai_usage');
    await pool.query(`DELETE FROM staff_user WHERE id = $1`, [STAFF]);
    await pool.end();
  });
  beforeEach(async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    settings = AiSettingsSchema.parse({});
    await pool.query('TRUNCATE ai_usage');
    await pool.query(`TRUNCATE ai_glossary`);
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $1, $1 || '@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`, [STAFF]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('translates a document in one call, keeping names and variables', async () => {
    const { results } = await translateItems(pool, {
      locale: 'vi',
      actorId: STAFF,
      items: [
        { id: 'a', text: 'Book Tàya House on {date}.', vars: ['date'] },
        { id: 'b', text: '{count, plural, one {# guest} other {# guests}}', vars: ['count'] },
      ],
    });
    expect(results).toEqual([
      { id: 'a', ok: true, text: '«vi» Book Tàya House on {date}.' },
      { id: 'b', ok: true, text: '«vi» {count, plural, one {# guest} other {# guests}}' },
    ]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE feature='translate'`)).rows[0].n).toBe(1);
  });

  it('rejects a dropped token (AI_FAKE_DROP_TOKEN)', async () => {
    await pool.query(`INSERT INTO ai_glossary (term, mode) VALUES ('Tàya House', 'keep')`);
    vi.stubEnv('AI_FAKE_DROP_TOKEN', '1');
    const { results } = await translateItems(pool, { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Tàya House' }] });
    expect(results).toEqual([{ id: 'a', ok: false, code: 'ai_placeholder' }]);
  });

  it('rejects a missing id or a changed ICU structure', async () => {
    const plural = '{count, plural, one {# guest} other {# guests}}';
    const model = answering([
      { id: 'a', text: 'Xin chào' },
      { id: 'c', text: '{count, plural, one {# khách}}' }, // lost `other`
    ]);
    const { results } = await translateItems(
      pool,
      { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'Bye' }, { id: 'c', text: plural, vars: ['count'] }] },
      { model },
    );
    expect(results).toEqual([
      { id: 'a', ok: true, text: 'Xin chào' },
      { id: 'b', ok: false, code: 'ai_placeholder' },
      { id: 'c', ok: false, code: 'ai_placeholder' },
    ]);
  });

  it('marks a result longer than maxLength', async () => {
    const { results } = await translateItems(pool, { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Hello', maxLength: 5 }] });
    expect(results).toEqual([{ id: 'a', ok: false, code: 'too_long' }]);
  });

  it('sends the glossary map target, the brand voice, the context and the system prompt', async () => {
    await pool.query(`INSERT INTO ai_glossary (term, mode, locale, target) VALUES ('Tàya House', 'map', 'vi', 'Nhà Tàya')`);
    settings = AiSettingsSchema.parse({ brandVoice: 'Warm and calm', features: { translate: { systemPrompt: 'Use polite register.' } } });
    const model = answering([{ id: 'a', text: '⟦G1⟧ mở cửa' }]);
    const { results } = await translateItems(
      pool,
      { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Tàya House opens', context: 'Hero line', maxLength: 90 }] },
      { model },
    );
    expect(results).toEqual([{ id: 'a', ok: true, text: 'Nhà Tàya mở cửa' }]);
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(sent).toContain('Use polite register.');
    expect(sent).toContain('Brand voice: Warm and calm');
    expect(sent).toContain('Vietnamese');
    expect(sent).toContain('TARGET: vi');
    expect(sent).toContain('Hero line');
    expect(sent).toContain('⟦G1⟧ opens');
    expect(sent).not.toContain('Tàya House opens');
  });

  it('does not throw on unparseable English for a keyed item; the answer is checked against its vars', async () => {
    const { results } = await translateItems(pool, { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: '{', vars: ['x'] }] });
    expect(results).toEqual([{ id: 'a', ok: false, code: 'ai_placeholder' }]);
  });

  it('refuses when the translate feature is off', async () => {
    settings = AiSettingsSchema.parse({ features: { translate: { enabled: false } } });
    await expect(translateItems(pool, { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Hi' }] })).rejects.toMatchObject({ code: 'ai_off' });
  });
});
