import 'server-only';
import { generateText, type LanguageModel } from 'ai';
import type { Pool } from 'pg';
import sharp from 'sharp';
import type { AiSettings } from '@/lib/admin/ai-schemas';
import { AiError } from '@/lib/server/ai-error';
import { languageModel, providerOptions } from './client';
import { runAiCall } from './guard';
import type { ModelId } from './models';
import { cachedAiSettings } from './settings';

/*
 * Alt text for a picture (spec §9.3, R9-12, R9-17): bytes in, one English
 * sentence out. The bytes come gathered by the CMS side
 * (content-admin/machine-alt.ts reads them through the media module), as a
 * loader this module calls only once the call is reserved: a click the limits
 * or the budget refuse costs no download and no decode. Nothing here reads a
 * table or writes one but ai_usage (runAiCall). The picture
 * leaves as a JPEG of at most ALT_EDGE px on its long edge, never larger
 * than it was. No guest data: a picture from the media library.
 */

/** media_i18n.alt holds at most this many characters (008: char_length(alt) <= 250). */
export const ALT_MAX = 250;
/** The long edge of what is sent (spec §9.3: about 1024 px). */
export const ALT_EDGE = 1024;
/** The upload's own pixel cap (lib/server/media/measure.ts MAX_PIXELS): a stored file never exceeds it. */
const MAX_PIXELS = 50_000_000;
/**
 * A 1024 px picture as input tokens, for the cost ceiling (R9-4): about
 * 1 300–1 400 on the catalogue's providers; the ceiling counts characters / 3.
 */
const IMAGE_CHARS = 1600 * 3;

/**
 * Upright (EXIF), at most ALT_EDGE px on its long edge, transparency on white
 * (JPEG has no alpha: left alone it turns black), JPEG quality 80. Throws on
 * bytes that are not a picture.
 */
export async function shrinkForAi(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: ALT_EDGE, height: ALT_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** At most `max` characters (code points), cut after the last whole word that fits, without trailing punctuation that joined it. */
export function fitWords(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, '');
}

/**
 * The model's answer as one line of alt text: no control or format characters
 * (a NUL, a bidi override; a control that is whitespace becomes a space), no
 * surrounding quotes, no line breaks, within ALT_MAX.
 */
export function cleanAlt(text: string, max = ALT_MAX): string {
  const line = text
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (/\s/.test(c) ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
    .trim();
  return fitWords(line, max);
}

/**
 * One call of the `alt` feature (its model, region and prompt). `actorId`
 * null is the automatic path after an upload (R9-3: not counted per person,
 * counted in the budget); the button passes the person. `deps.model` is the
 * tests' seam. `bytes` loads the picture; it runs inside the reserved call,
 * so a failed download or decode is that call's error (ai_failed, cost 0),
 * one ai_usage row like any other. Throws AiError (ai_off, the limits, the
 * budget, Vertex codes).
 */
export async function describeImage(
  pool: Pool,
  input: { bytes: () => Promise<Uint8Array>; actorId: string | null; signal?: AbortSignal; settings?: AiSettings },
  deps: { model?: LanguageModel } = {},
): Promise<{ alt: string; model: ModelId }> {
  const settings = input.settings ?? (await cachedAiSettings());
  const cfg = settings.features.alt;
  if (!cfg.enabled) throw new AiError('ai_off');
  const instructions = [
    'TASK: alt',
    'Describe this photo for a screen-reader user of a luxury resort restaurant website in one English sentence, under 125 characters, no "image of".',
    'Answer with the sentence only.',
    settings.brandVoice && `Brand voice: ${settings.brandVoice}`,
    cfg.systemPrompt,
  ]
    .filter(Boolean)
    .join('\n');
  const model = deps.model ?? languageModel(cfg);

  const alt = await runAiCall(
    pool,
    settings,
    { feature: 'alt', model: cfg.model, region: cfg.region, actorId: input.actorId, inputChars: instructions.length + IMAGE_CHARS, maxOutputTokens: cfg.maxOutputTokens, signal: input.signal },
    async (sig) => {
      const jpeg = await shrinkForAi(await input.bytes());
      const r = await generateText({
        model,
        instructions,
        messages: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/jpeg', data: jpeg }] }],
        maxOutputTokens: cfg.maxOutputTokens,
        maxRetries: 1,
        timeout: 30_000,
        abortSignal: sig,
        providerOptions: providerOptions(cfg),
      });
      const text = cleanAlt(r.text);
      // An empty answer is a failed call; the tokens it used are still billed (runAiCall reads `usage`).
      if (!text) throw Object.assign(new Error('empty alt text'), { usage: r.totalUsage });
      return { value: text, usage: r.totalUsage };
    },
  );
  return { alt, model: cfg.model };
}
