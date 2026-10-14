import 'server-only';
import { generateText, Output } from 'ai';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { AI_FEATURES, type AiFeature, type AiSettings, type FeatureConfig } from '@/lib/admin/ai-schemas';
import { languageModel, providerOptions, vertexAuth } from './client';
import { vertexErrorCode, type AiErrorCode } from './errors';
import { runAiCall } from './guard';
import { resolveAiMode } from './mode';
import { modelById, type ModelId, type Region } from './models';

/*
 * "Kiểm tra kết nối" (spec §9.2): per (model, region) pair that an enabled
 * feature uses, five steps (env, token, text, structured, image), stopping at
 * the first failure. Each model call goes through runAiCall as feature
 * 'check' with no actor: it costs budget but never counts toward a person's
 * limits. One deadline is shared by every pair; a pair that has no time left is
 * not run (steps: [], timedOut). No error text is kept: only the code.
 */
export type CheckStepName = 'env' | 'token' | 'text' | 'structured' | 'image';
export type CheckStep = { step: CheckStepName; ok: boolean; ms: number; tokens?: number; code?: AiErrorCode };
export type CheckRow = { features: AiFeature[]; model: ModelId; region: Region; steps: CheckStep[]; timedOut?: boolean };

const STEP_TIMEOUT_MS = 8000;
const TASK = 'TASK: check';

/** An 8x8 red PNG, built once. */
let redPng: Promise<Buffer> | undefined;
const image = () =>
  (redPng ??= sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png()
    .toBuffer());

type Deps = { auth?: () => { getAccessToken(): Promise<unknown> } | { credentials: unknown } };

export async function checkConnection(pool: Pool, settings: AiSettings, opts: { deadlineMs: number; withImage: boolean }, deps: Deps = {}): Promise<CheckRow[]> {
  const started = Date.now();
  const left = () => opts.deadlineMs - (Date.now() - started);

  const pairs = new Map<string, { row: CheckRow; cfg: FeatureConfig }>();
  for (const f of AI_FEATURES) {
    const cfg = settings.features[f];
    if (!cfg.enabled) continue;
    const key = `${cfg.model}|${cfg.region}`;
    const found = pairs.get(key);
    if (found) found.row.features.push(f);
    else pairs.set(key, { row: { features: [f], model: cfg.model, region: cfg.region, steps: [] }, cfg });
  }

  for (const { row, cfg } of pairs.values()) {
    if (left() <= 0) {
      row.timedOut = true;
      continue;
    }
    await runPair(pool, settings, row, cfg, opts.withImage, left, deps);
  }
  return [...pairs.values()].map((p) => p.row);
}

async function runPair(pool: Pool, settings: AiSettings, row: CheckRow, cfg: FeatureConfig, withImage: boolean, left: () => number, deps: Deps): Promise<void> {
  /** Runs one step; false (and the row ends) when it failed. */
  const step = async (name: CheckStepName, fn: (signal: AbortSignal) => Promise<number | undefined | void>): Promise<boolean> => {
    const t0 = Date.now();
    const remaining = left();
    if (remaining <= 0) {
      row.timedOut = true;
      return false;
    }
    try {
      const tokens = await fn(AbortSignal.timeout(Math.min(STEP_TIMEOUT_MS, remaining)));
      row.steps.push({ step: name, ok: true, ms: Date.now() - t0, ...(typeof tokens === 'number' ? { tokens } : {}) });
      return true;
    } catch (err) {
      row.steps.push({ step: name, ok: false, ms: Date.now() - t0, code: vertexErrorCode(err) });
      return false;
    }
  };

  let mode: ReturnType<typeof resolveAiMode> | undefined;
  const envOk = await step('env', async () => {
    mode = resolveAiMode();
    if (mode.mode === 'off') throw Object.assign(new Error('off'), { name: 'AiOffError' });
  });
  if (!envOk) {
    // 'off' and a refused configuration are one answer for staff: the AI is not configured.
    const last = row.steps[row.steps.length - 1];
    last.code = 'ai_off';
    return;
  }

  if (!(await step('token', async (signal) => {
    if (mode?.mode !== 'vertex') return; // fake: nothing to exchange
    const auth = deps.auth ? deps.auth() : vertexAuth();
    if (!('getAccessToken' in auth)) return;
    // getAccessToken takes no signal: race it, so a hung token exchange cannot outlast the step's time.
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('token timeout')), { once: true });
      Promise.resolve(auth.getAccessToken()).then(() => resolve(), reject);
    });
  }))) return;

  const model = languageModel(cfg);
  const options = providerOptions(cfg);
  const call = (inputChars: number, run: (signal: AbortSignal) => Promise<{ usage: { inputTokens?: number; outputTokens?: number } }>) => async (signal: AbortSignal) => {
    const usage = await runAiCall(pool, settings, { feature: 'check', model: cfg.model, region: cfg.region, actorId: null, inputChars, maxOutputTokens: 20, signal }, async () => {
      const r = await run(signal);
      return { value: r.usage, usage: r.usage };
    });
    return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  };

  if (!(await step('text', call(20, (abortSignal) =>
    generateText({ model, instructions: TASK, prompt: 'Reply with OK.', maxOutputTokens: 20, maxRetries: 1, abortSignal, providerOptions: options }).then((r) => ({ usage: r.totalUsage })),
  )))) return;

  if (!(await step('structured', call(40, (abortSignal) =>
    generateText({
      model,
      instructions: TASK,
      prompt: 'Reply with the JSON object {"ok": true}.',
      output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
      maxOutputTokens: 20,
      maxRetries: 1,
      abortSignal,
      providerOptions: options,
    }).then((r) => ({ usage: r.totalUsage })),
  )))) return;

  if (withImage && modelById(cfg.model).image) {
    const png = await image();
    await step('image', call(100, (abortSignal) =>
      generateText({
        model,
        instructions: TASK,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }, { type: 'file', mediaType: 'image/png', data: png }] }],
        maxOutputTokens: 20,
        maxRetries: 1,
        abortSignal,
        providerOptions: options,
      }).then((r) => ({ usage: r.totalUsage })),
    ));
  }
}
