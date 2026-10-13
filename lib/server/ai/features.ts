import 'server-only';
import { AI_FEATURES, type AiFeatures } from '@/lib/admin/ai-schemas';
import { resolveAiMode } from './mode';
import { cachedAiSettings } from './settings';

/** For the admin shell: which AI buttons to draw. Mode off (not configured) hides them all. */
export async function loadAiFeatures(): Promise<AiFeatures> {
  const off = resolveAiMode().mode === 'off';
  const settings = off ? null : await cachedAiSettings();
  return Object.fromEntries(AI_FEATURES.map((f) => [f, settings !== null && settings.features[f].enabled])) as AiFeatures;
}
