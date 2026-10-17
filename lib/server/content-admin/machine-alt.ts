import 'server-only';
import type { Pool } from 'pg';
import type { AiSettings } from '@/lib/admin/ai-schemas';
import { describeImage } from '@/lib/server/ai/alt';
import { vertexErrorCode } from '@/lib/server/ai/errors';
import { resolveAiMode } from '@/lib/server/ai/mode';
import type { ModelId } from '@/lib/server/ai/models';
import { loadAiSettings } from '@/lib/server/ai/settings';
import { imageForAi, writeMachineAlt } from '@/lib/server/media/library';

/*
 * The CMS side of alt text by AI (spec §9.3, R9-12, R9-17, R9-21): the
 * picture's bytes come from the media module (a live, non-decorative image
 * in Blob only), the AI gate describes them, and the media module writes the
 * answer into an empty place. Two callers, both in app/: the upload's after()
 * (generateAltQuietly, nobody's call) and "Viết alt bằng AI" (the route,
 * the person's call, nothing written). Cache expiry is app/'s (Luật 3).
 */

/**
 * The picture described, or null when it is not one the AI may describe
 * (static, PDF, decorative, in the trash, gone; with `withoutAlt`, already
 * described). The check is one SELECT; the download happens inside the
 * reserved call (a refused call reads nothing from the store).
 */
export async function describeMediaImage(
  pool: Pool,
  input: { mediaId: string; actorId: string | null; settings?: AiSettings; signal?: AbortSignal; withoutAlt?: boolean },
): Promise<{ alt: string; model: ModelId } | null> {
  const image = await imageForAi(pool, input.mediaId, { withoutAlt: input.withoutAlt });
  if (!image) return null;
  return describeImage(pool, { bytes: image.read, actorId: input.actorId, settings: input.settings, signal: input.signal });
}

const NOTHING = { wrote: false, shown: false } as const;

/**
 * After an upload (R9-21): EN alt by AI for a new picture without alt, when AI
 * is configured and the alt feature is on. The configuration is read
 * uncached, outside the request. Never throws: whatever fails (the budget,
 * Vertex, the store, the database) is logged by its code only, and the upload
 * it follows stays as it was.
 */
export async function generateAltQuietly(pool: Pool, mediaId: string): Promise<{ wrote: boolean; shown: boolean }> {
  try {
    if (resolveAiMode().mode === 'off') return NOTHING;
    const { settings } = await loadAiSettings(pool);
    if (!settings.features.alt.enabled) return NOTHING;
    const described = await describeMediaImage(pool, { mediaId, actorId: null, settings, withoutAlt: true });
    if (!described) return NOTHING;
    return await writeMachineAlt(pool, mediaId, described.alt, described.model);
  } catch (err) {
    console.warn(`[ai:alt] skipped code=${vertexErrorCode(err)}`);
    return NOTHING;
  }
}
