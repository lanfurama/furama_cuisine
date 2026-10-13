import 'server-only';
import { generateText, Output, type LanguageModel } from 'ai';
import type { Pool } from 'pg';
import { z } from 'zod';
import { englishName } from '@/lib/i18n/catalog';
import { checkMessage, messageArgs } from '@/lib/i18n/icu';
import { AiError } from './ai-error';
import { languageModel, providerOptions } from './client';
import { loadGlossary, mask, unmask } from './glossary';
import { runAiCall } from './guard';
import type { ModelId } from './models';
import { cachedAiSettings } from './settings';

/*
 * The translate core (spec §9.3, R9-7): one "document" of items, one call. Names
 * and simple variables leave as ⟦G1⟧/⟦V1⟧ tokens (glossary.ts); an answer that
 * loses, repeats or invents a token, breaks the ICU structure of a registry
 * string, or overruns maxLength is refused item by item, so broken text is
 * never handed back. Nothing here is saved: the callers (the field button, the
 * bulk job) decide what to do with a good result. Content only, no guest data.
 */
export type TranslateItem = { id: string; text: string; context?: string; maxLength?: number; vars?: readonly string[] };
export type Translated = { id: string; ok: true; text: string } | { id: string; ok: false; code: 'ai_placeholder' | 'too_long' };

/** One call translates at most this many items and characters (the route answers `invalid` beyond). */
export const MAX_ITEMS = 20;
export const MAX_CHARS = 4000;

/** The English text's ICU arguments; unparseable English gives none to compare with (the answer is still checked against `vars`). */
function referenceArgs(text: string) {
  try {
    return messageArgs(text);
  } catch {
    return undefined;
  }
}

const Result = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });

/** `deps.model` is the tests' seam; the routes never pass it. */
export async function translateItems(
  pool: Pool,
  input: { items: TranslateItem[]; locale: string; actorId: string | null; jobId?: string; signal?: AbortSignal },
  deps: { model?: LanguageModel } = {},
): Promise<{ results: Translated[]; model: ModelId }> {
  const { items, locale, actorId, jobId, signal } = input;
  const settings = await cachedAiSettings();
  const cfg = settings.features.translate;
  if (!cfg.enabled) throw new AiError('ai_off');

  const glossary = await loadGlossary(pool, locale);
  const masked = items.map((it) => ({ it, m: mask(it.text, glossary, locale) }));
  const instructions = [
    'TASK: translate',
    `TARGET: ${locale}`,
    `Translate each item's text from English to ${englishName(locale)} for a luxury resort's restaurant website.`,
    'Keep every ⟦…⟧ token exactly once and unchanged. Keep ICU MessageFormat syntax ({name}, {n, plural, …}, #) and translate only the words inside it.',
    'Return JSON {"items":[{"id","text"}]} with the same ids.',
    settings.brandVoice && `Brand voice: ${settings.brandVoice}`,
    cfg.systemPrompt,
  ]
    .filter(Boolean)
    .join('\n');
  const prompt = JSON.stringify({ items: masked.map(({ it, m }) => ({ id: it.id, text: m.text, context: it.context, maxLength: it.maxLength })) });
  const model = deps.model ?? languageModel(cfg);

  const out = await runAiCall(
    pool,
    settings,
    { feature: 'translate', model: cfg.model, region: cfg.region, actorId, jobId, inputChars: prompt.length + instructions.length, maxOutputTokens: cfg.maxOutputTokens, signal },
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

  const byId = new Map(out.items.map((x) => [x.id, x.text]));
  const results = masked.map(({ it, m }): Translated => {
    const raw = byId.get(it.id);
    if (raw === undefined) return { id: it.id, ok: false, code: 'ai_placeholder' };
    const u = unmask(raw, m);
    if (!u.ok) return { id: it.id, ok: false, code: 'ai_placeholder' };
    // Only a registry string (it declares its variables) is ICU; free content may hold any brace.
    if (it.vars && checkMessage(u.text, it.vars, referenceArgs(it.text)).length) return { id: it.id, ok: false, code: 'ai_placeholder' };
    if (it.maxLength && [...u.text].length > it.maxLength) return { id: it.id, ok: false, code: 'too_long' };
    return { id: it.id, ok: true, text: u.text };
  });
  return { results, model: cfg.model };
}
