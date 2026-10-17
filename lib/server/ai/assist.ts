import 'server-only';
import { createTextStreamResponse, streamText, type LanguageModel, type TextStreamPart, type ToolSet } from 'ai';
import type { Pool } from 'pg';
import { englishName } from '@/lib/i18n/catalog';
import { AiError } from '@/lib/server/ai-error';
import { languageModel, providerOptions } from './client';
import { reserveAiCall, type AiUsage } from './guard';
import { cachedAiSettings } from './settings';

/*
 * The writing assistant (spec §9.3, R9-10, R9-23): rewrite, shorten, or put
 * into the brand voice the text a field shows, in that field's language, and
 * stream the answer back as plain text. The panel only fills the form; staff
 * save as always, so nothing here writes content. The call goes through the
 * guard like every other: reserveAiCall before (budget, per-person limits),
 * settled with the real tokens when the stream ends, failed when it is
 * refused, breaks or is cancelled (the request's signal, or the reader going
 * away). Content only, no guest data.
 */
export const ASSIST_ACTIONS = ['rewrite', 'shorten', 'brand'] as const;
export type AssistAction = (typeof ASSIST_ACTIONS)[number];

/** The longest text the assistant takes (the route answers `invalid` beyond; the panel says so before calling). */
export { MAX_ASSIST_CHARS } from '@/lib/admin/assist';

/** The model call's own limit: well under the route's maxDuration (60 s), so the platform never kills the function first. */
export const ASSIST_TIMEOUT_MS = 50_000;
/** If no end, error, abort or cancel has closed the row by then, it is failed anyway: the kept-alive work always ends. */
const CLOSE_DEADLINE_MS = ASSIST_TIMEOUT_MS + 2_000;

const WHAT: Record<AssistAction, string> = {
  rewrite: 'Rewrite the text so it reads clearly and naturally, keeping its meaning and every fact.',
  shorten: 'Shorten the text to its essentials, keeping its meaning and every key fact.',
  brand: 'Rewrite the text in the brand voice given below, keeping its meaning and every fact.',
};

/** The call's instructions; the first two lines are what the fake model reads (lib/server/ai/fake.ts). */
export function assistInstructions(input: { action: AssistAction; locale: string; maxLength?: number; brandVoice: string; systemPrompt: string }): string {
  const { action, locale, maxLength, brandVoice, systemPrompt } = input;
  return [
    'TASK: assist',
    `ACTION: ${action}`,
    WHAT[action],
    "The text is copy for a luxury resort's restaurant website.",
    `Write in ${englishName(locale)}.`,
    'Answer with the text only: no title, no quotation marks, no notes or explanations.',
    'Keep names of restaurants and places, prices, times, phone numbers and any {placeholder} exactly as written.',
    maxLength && `Use at most ${maxLength} characters.`,
    brandVoice.trim() && `Brand voice: ${brandVoice.trim()}`,
    systemPrompt,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A Response streaming the answer as text/plain; a refusal or a failure before the first words throws (the route
 * answers JSON). Once the stream is under way, `keepAlive` receives the work that closes the usage row: the route
 * hands it to after(), so a function the client has left (the panel closed) is not frozen with the row still pending
 * at its ceiling. `deps.model` is the tests' seam.
 */
export async function assistStream(
  pool: Pool,
  input: {
    action: AssistAction;
    text: string;
    locale: string;
    maxLength?: number;
    actorId: string;
    signal: AbortSignal;
    keepAlive?: (work: Promise<void>) => void;
  },
  deps: { model?: LanguageModel } = {},
): Promise<Response> {
  const { action, text, locale, maxLength, actorId, signal, keepAlive } = input;
  const settings = await cachedAiSettings();
  const cfg = settings.features.assist;
  if (!cfg.enabled) throw new AiError('ai_off');
  if (action === 'brand' && !settings.brandVoice.trim()) throw new AiError('ai_off', { missing: 'brandVoice' });
  // streamText does not check an already aborted signal before calling (spike gotcha 5).
  if (signal.aborted) throw new AiError('ai_failed');

  const instructions = assistInstructions({ action, locale, maxLength, brandVoice: settings.brandVoice, systemPrompt: cfg.systemPrompt });
  const model = deps.model ?? languageModel(cfg);
  const reservation = await reserveAiCall(pool, settings, {
    feature: 'assist',
    model: cfg.model,
    region: cfg.region,
    actorId,
    inputChars: text.length + instructions.length,
    maxOutputTokens: cfg.maxOutputTokens,
    signal,
  });

  // The row is settled once: whichever of end, error, abort or cancel comes first. Every later
  // caller awaits that same write, so nothing throws or answers before the row has left 'pending'
  // (streamText's onError starts the failure before the reader sees the error part).
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => (markClosed = resolve));
  let closing: Promise<void> | null = null;
  const close = (write: () => Promise<void>) => (closing ??= write().finally(markClosed));
  const settle = (usage: AiUsage) => close(() => reservation.settle(usage).catch(() => console.error('[ai] usage settle failed', { code: 'settle' })));
  const fail = (err: unknown) => close(() => reservation.fail(err).then(() => {}));

  const result = streamText({
    model,
    instructions,
    prompt: text,
    maxOutputTokens: cfg.maxOutputTokens,
    maxRetries: 1,
    timeout: { totalMs: ASSIST_TIMEOUT_MS },
    abortSignal: signal,
    providerOptions: providerOptions(cfg),
    onEnd: ({ totalUsage }) => settle({ inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens }),
    onError: ({ error }) => fail(error),
    onAbort: () => fail(new AiError('ai_failed')),
  });

  const reader = result.stream.getReader();
  /** The next words, or null at the end; a failure part (or a stream that stops on an error) throws. */
  async function next(): Promise<string | null> {
    for (;;) {
      let part: ReadableStreamReadResult<TextStreamPart<ToolSet>>;
      try {
        part = await reader.read();
      } catch (err) {
        await fail(err);
        throw err;
      }
      if (part.done) return null;
      const p = part.value;
      if (p.type === 'text-delta') return p.text;
      if (p.type === 'error') {
        await fail(p.error);
        throw p.error instanceof Error ? p.error : new AiError('ai_failed');
      }
      if (p.type === 'abort') {
        await fail(new AiError('ai_failed'));
        throw new AiError('ai_failed');
      }
    }
  }

  // Wait for the first words, so a refusal or a failure before them is still a JSON answer.
  let first: string | null;
  try {
    first = await next();
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  if (first === null) {
    // The model answered nothing: the call is settled (onEnd), but there is nothing to show.
    await closing;
    throw new AiError('ai_failed');
  }

  // From here the answer streams: keep the function alive until the row is closed, whatever ends the call.
  const deadline = setTimeout(() => void fail(new AiError('ai_failed')), CLOSE_DEADLINE_MS);
  keepAlive?.(closed.finally(() => clearTimeout(deadline)));

  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(first);
    },
    async pull(controller) {
      try {
        const words = await next();
        if (words === null) controller.close();
        else controller.enqueue(words);
      } catch {
        // Cut the response: the panel sees the stream break and keeps the form as it was.
        controller.error(new Error('ai_stream_failed'));
      }
    },
    async cancel(reason) {
      // The reader went away (the panel closed, the page was left).
      await fail(new AiError('ai_failed'));
      await reader.cancel(reason).catch(() => {});
    },
  });
  return createTextStreamResponse({ stream, headers: { 'cache-control': 'no-store' } });
}
