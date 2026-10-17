import 'server-only';
import { generateText, Output, type LanguageModel } from 'ai';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AiSettings } from '@/lib/admin/ai-schemas';
import { englishName } from '@/lib/i18n/catalog';
import { REGISTRY } from '@/lib/i18n/registry';
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
 * and an answer with a token it was not given is refused (ai_placeholder).
 * The answer is cut to TITLE_MAX / DESCRIPTION_MAX at a word boundary, never
 * inside a name. Nothing is saved: the form fills its boxes and staff press
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
 * The model's answer may not pass the registry's own maximum for the home
 * page's title and description (the restaurant columns allow more), even
 * before it is cut to the search-result lengths above.
 */
const Result = z.object({
  title: z.string().min(1).max(REGISTRY['seo.home_title'].maxLength),
  description: z.string().min(1).max(REGISTRY['seo.home_description'].maxLength),
});

const chars = (s: string) => [...s];
const TRAILING = /[\s\p{P}]+$/u;

/**
 * `text` in at most `max` characters (code points, NFC, spaces collapsed): cut at
 * the last space that fits and not inside one of `keep` (names stay whole),
 * with no space or punctuation left at the end. A text without such a space
 * (one long word, or a long name) is cut hard.
 */
export function fitWords(text: string, max: number, keep: readonly string[] = []): string {
  const clean = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const cs = chars(clean);
  if (cs.length <= max) return clean;
  // Code-point ranges [start, end) of every kept name.
  const ranges: [number, number][] = [];
  for (const name of keep) {
    const n = chars(name.normalize('NFC'));
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
  return cs.slice(0, max).join('').replace(TRAILING, '');
}

/**
 * Puts the masked names back. Unlike a translation, a title uses only some of
 * the page's names, and may repeat one; a token the model invented, or a
 * broken one, refuses the answer. `names`: the names the text now holds.
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
  if (unknown || /[⟦⟧]/.test(out)) return { ok: false };
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

  const out = await runAiCall(
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
      return { value: r.output, usage: r.totalUsage };
    },
  );

  const title = restoreNames(out.title, masked);
  const description = restoreNames(out.description, masked);
  if (!title.ok || !description.ok) throw new AiError('ai_placeholder');
  const suggestion = { title: fitWords(title.text, TITLE_MAX, title.names), description: fitWords(description.text, DESCRIPTION_MAX, description.names) };
  if (!suggestion.title || !suggestion.description) throw new AiError('ai_failed');
  return suggestion;
}
