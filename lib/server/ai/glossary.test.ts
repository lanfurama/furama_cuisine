import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditActor } from '@/lib/server/audit';
import { TEST_DATABASE_URL } from '@/test/helpers/db';
import { deleteGlossaryEntry, listGlossary, loadGlossary, mask, saveGlossaryEntry, unmask, type GlossaryEntry } from './glossary';

const G: GlossaryEntry[] = [
  { term: 'Tàya House', mode: 'keep', locale: null, target: null },
  { term: 'Tàya', mode: 'keep', locale: null, target: null },
  { term: 'Da Nang', mode: 'map', locale: 'vi', target: 'Đà Nẵng' },
];

describe('mask and unmask', () => {
  it('masks longest terms first, whole words only, and simple ICU variables', () => {
    const m = mask('Book Tàya House in Da Nang, call {phone}. Tàyara is not Tàya.', G, 'vi');
    expect(m.text).toBe('Book ⟦G1⟧ in ⟦G2⟧, call ⟦V1⟧. Tàyara is not ⟦G3⟧.');
    expect(m.tokens.map((t) => t.restore)).toEqual(['Tàya House', 'Đà Nẵng', '{phone}', 'Tàya']);
  });
  it('keeps a map term as written when the target language has no target', () => {
    expect(mask('Da Nang', G, 'ko').text).toBe('Da Nang');
  });
  it('restores every token once', () => {
    const m = mask('Tàya House, {phone}', G, 'vi');
    expect(unmask('⟦G1⟧, gọi ⟦V1⟧', m)).toEqual({ ok: true, text: 'Tàya House, gọi {phone}' });
  });
  it('refuses a dropped, duplicated or invented token', () => {
    const m = mask('Tàya House, {phone}', G, 'vi');
    expect(unmask('gọi ⟦V1⟧', m)).toEqual({ ok: false });
    expect(unmask('⟦G1⟧ ⟦G1⟧ ⟦V1⟧', m)).toEqual({ ok: false });
    expect(unmask('⟦G1⟧ ⟦V1⟧ ⟦G9⟧', m)).toEqual({ ok: false });
  });
  it('leaves plural and select messages unmasked (their words need translating)', () => {
    const t = '{count, plural, one {# guest} other {# guests}} at Tàya House';
    expect(mask(t, G, 'vi').text).toBe('{count, plural, one {# guest} other {# guests}} at ⟦G1⟧');
  });
  it('does not match inside a word or across case', () => {
    expect(mask('tàya house', G, 'vi').tokens).toHaveLength(0);
  });
  it('matches on NFC-normalised text and escapes special characters in a term', () => {
    const decomposed = 'Tàya House';
    expect(mask(decomposed, G, 'vi').text).toBe('⟦G1⟧');
    const m = mask('Visit C++ (new) now', [{ term: 'C++ (new)', mode: 'keep', locale: null, target: null }], 'vi');
    expect(m.text).toBe('Visit ⟦G1⟧ now');
  });
  it('a map term wins over a keep term of the same text for its language', () => {
    const m = mask('Da Nang', [{ term: 'Da Nang', mode: 'keep', locale: null, target: null }, ...G], 'vi');
    expect(m.tokens.map((t) => t.restore)).toEqual(['Đà Nẵng']);
  });
});

const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
let pool: Pool;

describe.skipIf(!TEST_DATABASE_URL)('glossary (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query('DELETE FROM ai_glossary');
    await pool.query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query('DELETE FROM ai_glossary');
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`);
  });

  it('loads rows for the language or every language, plus restaurant names as automatic keep terms', async () => {
    await pool.query(`INSERT INTO ai_glossary (term, mode) VALUES ('Furama', 'keep')`);
    await pool.query(`INSERT INTO ai_glossary (term, mode, locale, target) VALUES ('Da Nang', 'map', 'vi', 'Đà Nẵng'), ('Da Nang', 'map', 'en', 'Danang')`);
    const vi = await loadGlossary(pool, 'vi');
    expect(vi).toContainEqual({ term: 'Furama', mode: 'keep', locale: null, target: null });
    expect(vi).toContainEqual({ term: 'Da Nang', mode: 'map', locale: 'vi', target: 'Đà Nẵng' });
    expect(vi.find((e) => e.target === 'Danang')).toBeUndefined();
    expect(vi).toContainEqual({ term: 'Danaksara', mode: 'keep', locale: null, target: null, auto: true });
  });

  it('sees a renamed restaurant at once', async () => {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM restaurants WHERE id = 'danaksara'`);
    try {
      await pool.query(`UPDATE restaurants SET name = 'Danaksara Renamed' WHERE id = 'danaksara'`);
      const terms = (await loadGlossary(pool, 'vi')).map((e) => e.term);
      expect(terms).toContain('Danaksara Renamed');
      expect(terms).not.toContain('Danaksara');
    } finally {
      await pool.query(`UPDATE restaurants SET name = $1 WHERE id = 'danaksara'`, [rows[0].name]);
    }
  });

  it('lists stored rows with their id and restaurant names as read-only rows', async () => {
    await pool.query(`INSERT INTO ai_glossary (term, mode) VALUES ('Furama', 'keep')`);
    const list = await listGlossary(pool);
    expect(list.find((e) => e.term === 'Furama')?.id).toMatch(/^\d+$/);
    const auto = list.find((e) => e.term === 'Danaksara');
    expect(auto).toMatchObject({ auto: true, id: null, mode: 'keep' });
  });

  it('saves, audits, and refuses a duplicate (term, locale)', async () => {
    const res = await saveGlossaryEntry(pool, ACTOR, { term: ' Furama ', mode: 'keep', locale: null, target: null });
    expect(res.ok).toBe(true);
    const { rows } = await pool.query(`SELECT entity_type, action, after FROM audit_log`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'ai_glossary', action: 'create' });
    expect(rows[0].after.term).toBe('Furama');
    const dup = await saveGlossaryEntry(pool, ACTOR, { term: 'Furama', mode: 'keep', locale: null, target: null });
    expect(dup).toEqual({ ok: false, code: 'invalid', fieldErrors: { term: ['Thuật ngữ này đã có.'] } });
  });

  it('refuses a map without a target or language, and an unknown language', async () => {
    const noTarget = await saveGlossaryEntry(pool, ACTOR, { term: 'Da Nang', mode: 'map', locale: 'vi', target: null });
    expect(noTarget).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { target: [expect.any(String)] } });
    const noLocale = await saveGlossaryEntry(pool, ACTOR, { term: 'Da Nang', mode: 'map', locale: null, target: 'Đà Nẵng' });
    expect(noLocale).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { locale: [expect.any(String)] } });
    const unknown = await saveGlossaryEntry(pool, ACTOR, { term: 'Da Nang', mode: 'keep', locale: 'xx', target: null });
    expect(unknown).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { locale: [expect.any(String)] } });
  });

  it('updates a row (keep drops its target) and audits before and after', async () => {
    const created = await saveGlossaryEntry(pool, ACTOR, { term: 'Da Nang', mode: 'map', locale: 'vi', target: 'Đà Nẵng' });
    if (!created.ok) throw new Error('create failed');
    const upd = await saveGlossaryEntry(pool, ACTOR, { id: created.data.id, term: 'Da Nang', mode: 'keep', locale: 'vi', target: 'ignored' });
    expect(upd).toEqual({ ok: true, data: { id: created.data.id } });
    const { rows } = await pool.query(`SELECT mode, target FROM ai_glossary`);
    expect(rows).toEqual([{ mode: 'keep', target: null }]);
    const audit = await pool.query(`SELECT before, after FROM audit_log WHERE action = 'update'`);
    expect(audit.rows[0].before.mode).toBe('map');
    expect(audit.rows[0].after.mode).toBe('keep');
    expect(await saveGlossaryEntry(pool, ACTOR, { id: '999999', term: 'x', mode: 'keep', locale: null, target: null })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('deletes with an audit row, and answers not_found for a missing id', async () => {
    const created = await saveGlossaryEntry(pool, ACTOR, { term: 'Furama', mode: 'keep', locale: null, target: null });
    if (!created.ok) throw new Error('create failed');
    expect(await deleteGlossaryEntry(pool, ACTOR, created.data.id)).toEqual({ ok: true, data: null });
    expect((await pool.query('SELECT 1 FROM ai_glossary')).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM audit_log WHERE action = 'delete' AND entity_type = 'ai_glossary'`)).rowCount).toBe(1);
    expect(await deleteGlossaryEntry(pool, ACTOR, created.data.id)).toMatchObject({ ok: false, code: 'not_found' });
  });
});
