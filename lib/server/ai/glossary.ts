import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { messageArgs } from '@/lib/i18n/icu';
import type { ActionResult } from '@/lib/server/action-result';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';

/*
 * The AI glossary (spec §9.2, R9-6, R9-7). Terms the model must not translate
 * (keep) or must always render one way per language (map) are swapped for
 * ⟦G1⟧… before the text leaves for Vertex, and simple ICU variables {name}
 * for ⟦V1⟧…; unmask puts them back and refuses a result in which any symbol
 * is missing, repeated or invented. Restaurant names are not rows: loadGlossary
 * adds restaurants.name (every language, archived included) as keep terms, so
 * a rename or delete needs no second copy to sync. Content, not guest data.
 */

export type GlossaryEntry = { term: string; mode: 'keep' | 'map'; locale: string | null; target: string | null; auto?: boolean };
type Db = Pool | PoolClient;
export type Masked = { text: string; tokens: { token: string; restore: string }[] };

const nfc = (s: string) => s.normalize('NFC');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\\-/]/g, '\\$&');
const VARIABLE = /\{[A-Za-z0-9_]+\}/;

/** True when `text` has plural, select or selectordinal: its inner words need translating, so no variable is masked. */
function hasBranches(text: string): boolean {
  try {
    return messageArgs(text).some((a) => a.type === 'plural' || a.type === 'select' || a.type === 'selectordinal');
  } catch {
    return false;
  }
}

export function mask(text: string, glossary: readonly GlossaryEntry[], targetLocale: string): Masked {
  const source = nfc(text);
  // Entries for this language only; a language's own entry beats a general one of the same term.
  const byTerm = new Map<string, GlossaryEntry>();
  for (const e of [...glossary].sort((a, b) => Number(b.locale === targetLocale) - Number(a.locale === targetLocale))) {
    if (e.locale !== null && e.locale !== targetLocale) continue;
    const term = nfc(e.term.trim());
    if (term && !byTerm.has(term)) byTerm.set(term, e);
  }
  const terms = [...byTerm.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const alternatives = terms.map((t) => `(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`);
  if (!hasBranches(source)) alternatives.push(VARIABLE.source);
  if (alternatives.length === 0) return { text: source, tokens: [] };

  const tokens: Masked['tokens'] = [];
  let g = 0;
  let v = 0;
  const out = source.replace(new RegExp(alternatives.join('|'), 'gu'), (found) => {
    const entry = byTerm.get(found);
    const token = entry ? `⟦G${++g}⟧` : `⟦V${++v}⟧`;
    const restore = !entry ? found : entry.mode === 'map' && entry.target ? nfc(entry.target) : found;
    tokens.push({ token, restore });
    return token;
  });
  return { text: out, tokens };
}

export function unmask(translated: string, masked: Masked): { ok: true; text: string } | { ok: false } {
  const found = translated.match(/⟦[GV]\d+⟧/g) ?? [];
  const known = new Set(masked.tokens.map((t) => t.token));
  if (found.length !== known.size || new Set(found).size !== found.length || found.some((t) => !known.has(t))) return { ok: false };
  const restore = new Map(masked.tokens.map((t) => [t.token, t.restore]));
  return { ok: true, text: translated.replace(/⟦[GV]\d+⟧/g, (t) => restore.get(t) ?? t) };
}

// ── the database ──────────────────────────────────────────────────────────

type Row = { term: string; mode: 'keep' | 'map'; locale: string | null; target: string | null };

/** The terms for one target language: its rows and the every-language ones, plus every restaurant's name. */
export async function loadGlossary(db: Db, locale: string): Promise<GlossaryEntry[]> {
  const [glossary, names] = await Promise.all([
    db.query<Row>(`SELECT term, mode, locale, target FROM ai_glossary WHERE locale IS NULL OR locale = $1 ORDER BY id`, [locale]),
    db.query<{ name: string }>(`SELECT DISTINCT name FROM restaurants WHERE btrim(name) <> '' ORDER BY name`),
  ]);
  return [...glossary.rows, ...names.rows.map((r): GlossaryEntry => ({ term: r.name, mode: 'keep', locale: null, target: null, auto: true }))];
}

/** For the settings table: every stored row with its id, then the restaurant names (read-only, no id). */
export async function listGlossary(db: Db): Promise<(GlossaryEntry & { id: string | null })[]> {
  const [glossary, names] = await Promise.all([
    db.query<Row & { id: string }>(`SELECT id::text, term, mode, locale, target FROM ai_glossary ORDER BY lower(term), locale NULLS FIRST, id`),
    db.query<{ name: string }>(`SELECT DISTINCT name FROM restaurants WHERE btrim(name) <> '' ORDER BY name`),
  ]);
  return [...glossary.rows, ...names.rows.map((r) => ({ id: null, term: r.name, mode: 'keep' as const, locale: null, target: null, auto: true }))];
}

export type GlossaryInput = { id?: string; term: string; mode: 'keep' | 'map'; locale: string | null; target: string | null };

const invalid = (field: string, message: string): ActionResult<never> => ({ ok: false, code: 'invalid', fieldErrors: { [field]: [message] } });
const isDuplicate = (err: unknown) => (err as { constraint?: string } | null)?.constraint === 'ai_glossary_term_locale_idx';

export async function saveGlossaryEntry(pool: Pool, actor: AuditActor, input: GlossaryInput): Promise<ActionResult<{ id: string }>> {
  const term = nfc(input.term.trim());
  const mode = input.mode;
  const locale = input.locale?.trim() || null;
  const target = mode === 'map' ? nfc((input.target ?? '').trim()) || null : null;
  if (term.length < 1 || term.length > 80) return invalid('term', 'Thuật ngữ dài 1 đến 80 ký tự.');
  if (mode === 'map' && !locale) return invalid('locale', 'Chọn ngôn ngữ cho thuật ngữ đổi tên.');
  if (mode === 'map' && !target) return invalid('target', 'Nhập chữ thay thế.');
  if (target && target.length > 80) return invalid('target', 'Chữ thay thế tối đa 80 ký tự.');
  try {
    return await withTransaction(pool, async (client) => {
      if (locale) {
        const known = await client.query('SELECT 1 FROM locales WHERE code = $1', [locale]);
        if (!known.rowCount) return invalid('locale', 'Ngôn ngữ này không có.');
      }
      if (input.id) {
        const before = await client.query<Row>('SELECT term, mode, locale, target FROM ai_glossary WHERE id = $1 FOR UPDATE', [input.id]);
        if (!before.rows[0]) return { ok: false, code: 'not_found' } as const;
        await client.query('UPDATE ai_glossary SET term = $2, mode = $3, locale = $4, target = $5, updated_at = now(), updated_by = $6 WHERE id = $1', [
          input.id, term, mode, locale, target, actor.id,
        ]);
        await insertAudit(client, actor, { action: 'update', entityType: 'ai_glossary', entityId: input.id, before: before.rows[0], after: { term, mode, locale, target } });
        return { ok: true, data: { id: input.id } } as const;
      }
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO ai_glossary (term, mode, locale, target, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::text',
        [term, mode, locale, target, actor.id],
      );
      await insertAudit(client, actor, { action: 'create', entityType: 'ai_glossary', entityId: rows[0].id, after: { term, mode, locale, target } });
      return { ok: true, data: { id: rows[0].id } } as const;
    });
  } catch (err) {
    if (isDuplicate(err)) return invalid('term', 'Thuật ngữ này đã có.');
    throw err;
  }
}

export async function deleteGlossaryEntry(pool: Pool, actor: AuditActor, id: string): Promise<ActionResult> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<Row>('DELETE FROM ai_glossary WHERE id = $1 RETURNING term, mode, locale, target', [id]);
    if (!rows[0]) return { ok: false, code: 'not_found' } as const;
    await insertAudit(client, actor, { action: 'delete', entityType: 'ai_glossary', entityId: id, before: rows[0] });
    return { ok: true, data: null } as const;
  });
}
