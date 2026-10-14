import 'server-only';
import { DEFAULT_MODEL, MODEL_CATALOGUE, MODEL_IDS, MODEL_REGIONS, REGIONS, type ModelEntry, type ModelId, type Region } from '@/lib/admin/ai-models';

/*
 * The models the admin may choose (spec §9.1), checked against Google Cloud's
 * model cards on 2026-10-13:
 * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models
 * https://cloud.google.com/vertex-ai/generative-ai/pricing
 * Ids, labels and regions are in lib/admin/ai-models.ts (the browser needs
 * them); the prices are here. Prices are USD per 1M tokens on the global
 * endpoint; us/eu cost 10% more (R9-5). gemini-3.8-flash is priced after its
 * promotion (credits back until 2026-12-31), so the budget errs high.
 * Gemini's thinking tokens are inside outputTokens. Claude Haiku 5.5 is the
 * price above 100K tokens (higher, so the budget errs high). Claude must be
 * enabled in Model Garden first (spec §15.10).
 */
export { DEFAULT_MODEL, MODEL_IDS, MODEL_REGIONS, REGIONS };
export type { ModelId, Region };

export type ModelInfo = ModelEntry & {
  id: ModelId;
  /** USD per 1M tokens, global. */
  inUsd: number;
  outUsd: number;
};

const PRICES: Record<ModelId, { inUsd: number; outUsd: number }> = {
  'gemini-3.8-flash': { inUsd: 1.5, outUsd: 7.5 },
  'gemini-3.5-flash-lite': { inUsd: 0.3, outUsd: 2.5 },
  'claude-haiku-5-5': { inUsd: 0.5, outUsd: 2.5 },
  'claude-sonnet-5-5': { inUsd: 2, outUsd: 10 },
  'claude-opus-5-5': { inUsd: 4, outUsd: 20 },
};

export const MODELS: readonly ModelInfo[] = MODEL_CATALOGUE.map((m) => ({ ...m, ...PRICES[m.id] }));

export function modelById(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id}`);
  return m;
}

export function priceUsd(id: ModelId, region: Region, inputTokens: number, outputTokens: number): number {
  const m = modelById(id);
  const factor = region === 'global' ? 1 : 1.1;
  return ((inputTokens * m.inUsd + outputTokens * m.outUsd) / 1_000_000) * factor;
}
