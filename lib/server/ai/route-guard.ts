import 'server-only';
import { draftMode } from 'next/headers';
import type { AiFeature, AiSettings } from '@/lib/admin/ai-schemas';
import type { StaffSession } from '@/lib/server/dal/session';
import { AiError, AiOriginError } from '@/lib/server/ai-error';
import { resolveAiMode } from './mode';
import { cachedAiSettings } from './settings';

/**
 * The rest of every /api/admin/ai/* route's opening, after the handler's own
 * first statement `const staff = await requirePermission({ content: ['ai'] })`
 * (the CI guard wants it literally there): the request comes from this site,
 * is not a Draft Mode preview (R9-14), AI is configured and the feature is on.
 * Throws AiOriginError or AiError; the handler answers with aiErrorResponse.
 * `staff` is taken so the order cannot be forgotten: no staff, no settings.
 */
export async function aiRoute(request: Request, feature: AiFeature, staff: StaffSession): Promise<{ staff: StaffSession; settings: AiSettings }> {
  assertSameOrigin(request);
  if ((await draftMode()).isEnabled) throw new AiError('ai_preview');
  const settings = await cachedAiSettings();
  if (resolveAiMode().mode === 'off' || !settings.features[feature].enabled) throw new AiError('ai_off');
  return { staff, settings };
}

/** A state-changing request comes from this site (spec §7.1), or AiOriginError: for a route that calls no model (cancelling a job). */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AiOriginError();
}
