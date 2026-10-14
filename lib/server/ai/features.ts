import 'server-only';
import { AI_FEATURES, type AiFeatures } from '@/lib/admin/ai-schemas';
import { resolveAiMode } from './mode';
import { cachedAiSettings } from './settings';

/**
 * For the admin shell: which AI buttons to draw. Mode off (not configured) hides them all, and so does any
 * failure here (a refused configuration, the database): the shell must never fall over for an AI setting.
 * Only the error's name is logged, never its message.
 */
export async function loadAiFeatures(): Promise<AiFeatures> {
  try {
    if (resolveAiMode().mode === 'off') return NONE();
    const settings = await cachedAiSettings();
    return Object.fromEntries(AI_FEATURES.map((f) => [f, settings.features[f].enabled])) as AiFeatures;
  } catch (err) {
    console.error('[ai] features unavailable', { name: err instanceof Error ? err.name : typeof err });
    return NONE();
  }
}

const NONE = (): AiFeatures => Object.fromEntries(AI_FEATURES.map((f) => [f, false])) as AiFeatures;
