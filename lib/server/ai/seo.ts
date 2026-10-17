import 'server-only';
import { generateText, Output, type LanguageModel } from 'ai';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AiSettings } from '@/lib/admin/ai-schemas';
import { englishName } from '@/lib/i18n/catalog';
import { AiError } from '@/lib/server/ai-error';
import { languageModel, providerOptions } from './client';
import { loadGlossary, mask, type Masked } from './glossary';
import { runAiCall } from './guard';
import { cachedAiSettings } from './settings';

/*
 * "Gợi ý bằng AI" for SEO (spec §9.3, R9-22): a search-result title and meta
 * description for one page, in one language, in one call. The page's content
 * arrives gathered (R9-17: lib/server/content-admin/seo-material.ts reads it,
 * never the client); this module only words it. Names (the glossary and every
 * restaurant's name) leave as ⟦G1⟧ tokens, so the model cannot respell them,
 * and an answer with a token it was not given is refused (ai_placeholder),
 * as a failed call on the ledger. The answer loses control and invisible
 * characters and is cut to TITLE_MAX / DESCRIPTION_MAX at a word boundary,
 * never inside a name. Nothing is saved: the form fills its boxes and staff press
 * Lưu. Content only, no guest data.
 */

/** Spec §9.3: what search results show of a title and of a description. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;
/** What the material may send at most (spec §9.4: the input is bounded). */
export const MATERIAL_MAX_CHARS = 4000;

/** What a page is about, gathered on the CMS side: labelled English field names, text as guests read it. */
export type SeoMaterial = { page: 'home' | 'restaurant'; fields: { label: string; text: string }[] };
export type SeoSuggestion = { title: string; description: string };

/*
 * Only a runaway answer is refused here: Claude on Vertex sends the schema
 * without maxLength and checks it after the answer, so a cap at the
 * registry's maximum (70/200) would bill a 72-character title as a failure.
 * fitWords cuts every answer to TITLE_MAX / DESCRIPTION_MAX, within the
 * registry's maxima and the restaurant columns'.
 */
const RUNAWAY = { title: 300, description: 600 };
const Result = z.object({ title: z.string().min(1).max(RUNAWAY.title), description: z.string().min(1).max(RUNAWAY.description) });

const chars = (s: string) => [...s];
const TRAILING = /[\s\p{P}]+$/u;
/** Control and invisible format characters (bidi overrides, NUL, BEL, zero-width space), except the joiners ZWNJ and ZWJ that some scripts and emoji need. */
const INVISIBLE = /(?![\u200C\u200D])[\p{Cc}\p{Cf}]/gu;
/** A token the model rewrote in other brackets (〚G1〛, [G1], ( V2 )): a name it did not copy. */
const LOOK_ALIKE = /[\p{Ps}<]\s*[GV]\d+\s*[\p{Pe}>]/u;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** NFC, every run of whitespace one space, no control or invisible character, trimmed. */
function clean(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
}

/** The first graphemes of `text` that fit in `max` code points (a hard cut never splits an emoji sequence or a letter from its mark). */
function graphemesUpTo(text: string, max: number): string {
  let out = '';
  let used = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const n = chars(segment).length;
    if (used + n > max) break;
    out += segment;
    used += n;
  }
  return out;
}

/**
 * `text` in at most `max` characters (code points; cleaned: NFC, spaces
 * collapsed, no control or invisible character): cut at the last space that
 * fits and not inside one of `keep` (names stay whole, read the same way),
 * with no space or punctuation left at the end. A text without such a space
 * (one long word, or a long name) is cut hard, by whole graphemes.
 */
export function fitWords(text: string, max: number, keep: readonly string[] = []): string {
  const whole = clean(text);
  const cs = chars(whole);
  if (cs.length <= max) return whole;
  // Code-point ranges [start, end) of every kept name.
  const ranges: [number, number][] = [];
  for (const name of keep) {
    const n = chars(clean(name));
    if (n.length === 0) continue;
    for (let i = 0; i + n.length <= cs.length; i++) {
      if (n.every((c, j) => cs[i + j] === c)) ranges.push([i, i + n.length]);
    }
  }
  const insideName = (i: number) => ranges.some(([s, e]) => s < i && i < e);
  for (let i = max; i > 0; i--) {
    if (cs[i] !== ' ' || insideName(i)) continue;
    const cut = cs.slice(0, i).join('').replace(TRAILING, '');
    if (cut) return cut;
  }
  return graphemesUpTo(whole, max).replace(TRAILING, '');
}

/**
 * Puts the masked names back. Unlike a translation, a title uses only some of
 * the page's names, and may repeat one; a token the model invented, a broken
 * one, or one rewritten in other brackets refuses the answer. `names`: the
 * names the text now holds.
 */
export function restoreNames(text: string, masked: Masked): { ok: true; text: string; names: string[] } | { ok: false } {
  const restore = new Map(masked.tokens.map((t) => [t.token, t.restore]));
  const names = new Set<string>();
  let unknown = false;
  const out = text.replace(/⟦[GV]\d+⟧/g, (t) => {
    const name = restore.get(t);
    if (name === undefined) {
      unknown = true;
      return t;
    }
    names.add(name);
    return name;
  });
  if (unknown || /[⟦⟧]/.test(out) || LOOK_ALIKE.test(out)) return { ok: false };
  return { ok: true, text: out, names: [...names] };
}

/** The material as the model reads it: one labelled line per field, cut to MATERIAL_MAX_CHARS in all. */
function materialText(material: SeoMaterial): string {
  const lines = [`Page: ${material.page === 'home' ? 'the home page' : 'a restaurant page'}`];
  let left = MATERIAL_MAX_CHARS - lines[0].length;
  for (const { label, text } of material.fields) {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const room = left - label.length - 3;
    if (room <= 0) break;
    const line = `${label}: ${room >= value.length ? value : fitWords(value, room)}`;
    lines.push(line);
    left -= line.length + 1;
  }
  return lines.join('\n');
}

/**
 * One suggestion. `actorId`: the person who pressed (their limits count, R9-3).
 * `input.settings`: the configuration the route read; else the cached one.
 * `deps.model` is the tests' seam; the route never passes it.
 */
export async function suggestSeo(
  pool: Pool,
  input: { material: SeoMaterial; locale: string; actorId: string; signal?: AbortSignal; settings?: AiSettings },
  deps: { model?: LanguageModel } = {},
): Promise<SeoSuggestion> {
  const { material, locale, actorId, signal } = input;
  const settings = input.settings ?? (await cachedAiSettings());
  const cfg = settings.features.seo;
  if (!cfg.enabled) throw new AiError('ai_off');

  const masked = mask(materialText(material), await loadGlossary(pool, locale), locale);
  const instructions = [
    'TASK: seo',
    `TARGET: ${locale}`,
    `Write the search-result title and meta description of one page of a luxury resort's restaurant website, in ${englishName(locale)}.`,
    `The title: at most ${TITLE_MAX} characters. The description: at most ${DESCRIPTION_MAX} characters, one or two sentences.`,
    'Use only facts the page content states; never invent prices, awards, opening hours, offers or claims.',
    material.page === 'restaurant' ? "Name the restaurant in the title with its own token (the Name line's)." : null,
    'Each ⟦…⟧ token stands for a name: copy a token exactly as it is when you use it, never write the name yourself.',
    'Return JSON {"title","description"}.',
    settings.brandVoice && `Brand voice: ${settings.brandVoice}`,
    cfg.systemPrompt,
  ]
    .filter(Boolean)
    .join('\n');
  const prompt = masked.text;
  const model = deps.model ?? languageModel(cfg);

  return runAiCall(
    pool,
    settings,
    { feature: 'seo', model: cfg.model, region: cfg.region, actorId, inputChars: prompt.length + instructions.length, maxOutputTokens: cfg.maxOutputTokens, signal },
    async (sig) => {
      const r = await generateText({
        model,
        instructions,
        prompt,
        output: Output.object({ schema: Result }),
        maxOutputTokens: cfg.maxOutputTokens,
        maxRetries: 1,
        timeout: 60_000,
        abortSignal: sig,
        providerOptions: providerOptions(cfg),
      });
      // A refused answer is a failed call on the ledger (its code, its tokens), still one row.
      const refuse = (code: 'ai_placeholder' | 'ai_failed') => Object.assign(new AiError(code), { usage: r.totalUsage });
      const title = restoreNames(r.output.title, masked);
      const description = restoreNames(r.output.description, masked);
      if (!title.ok || !description.ok) throw refuse('ai_placeholder');
      const value = { title: fitWords(title.text, TITLE_MAX, title.names), description: fitWords(description.text, DESCRIPTION_MAX, description.names) };
      if (!HAS_WORD.test(value.title) || !HAS_WORD.test(value.description)) throw refuse('ai_failed');
      return { value, usage: r.totalUsage };
    },
  );
}
