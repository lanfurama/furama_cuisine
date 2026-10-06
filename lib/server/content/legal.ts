import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { resolveStrings } from '@/lib/i18n/resolve';
import { PRIVACY_KEYS } from '@/lib/legal';
import { getPool } from '@/db/client';
import { currentPolicyVersion } from './policy-version';
import { loadStringRows } from './strings.queries';

/**
 * The privacy policy's text in `locale` (DB override, else registry). Tagged
 * content:legal (spec §6.2), so the phase-7 editor that saves legal.* refreshes
 * this page without touching the rest of the UI strings; i18n:<locale> as for
 * every reader of one language.
 */
export async function getPrivacyStrings(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.legal.tags, TAGS.i18n(locale));

  const { defaultLocale, rows } = await loadStringRows(locale, PRIVACY_KEYS);
  return resolveStrings(rows, PRIVACY_KEYS, locale, defaultLocale);
}

/**
 * The policy version a guest reading `locale` agrees to, and the date the page
 * prints (legal_versions, migrations 009 and 010): that language's own
 * newest, else the English one (`locale` names which, R8-7).
 */
export async function getPolicyVersion(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.policyVersion.tags, TAGS.i18n(locale));

  const { version, effectiveOn, locale: consentLocale } = await currentPolicyVersion(getPool(), locale);
  return { version, effectiveOn, consentLocale };
}
