/*
 * The models the admin may choose (spec §9.1): ids, labels, provider and the
 * regions each serves. Client-safe (the settings form and AiSettingsSchema
 * use it); prices live in lib/server/ai/models.ts.
 */
export const REGIONS = ['global', 'us', 'eu'] as const;
export type Region = (typeof REGIONS)[number];

export type ModelEntry = {
  id: string;
  label: string;
  provider: 'google' | 'anthropic';
  regions: readonly Region[];
  image: boolean;
  structured: boolean;
};

export const MODEL_CATALOGUE = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (mặc định)', provider: 'google', regions: REGIONS, image: true, structured: true },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (rẻ)', provider: 'google', regions: REGIONS, image: true, structured: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true },
] as const satisfies readonly ModelEntry[];

export type ModelId = (typeof MODEL_CATALOGUE)[number]['id'];
export const MODEL_IDS = MODEL_CATALOGUE.map((m) => m.id) as [ModelId, ...ModelId[]];
export const DEFAULT_MODEL: ModelId = 'gemini-3.8-flash';
export const MODEL_REGIONS = Object.fromEntries(MODEL_CATALOGUE.map((m) => [m.id, m.regions])) as unknown as Record<ModelId, readonly Region[]>;
