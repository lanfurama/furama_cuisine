import { localeHref } from '@/lib/i18n/href';
import type { StringKey } from '@/lib/i18n/registry';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The guest privacy policy (spec §11): its page, its version and the keys it
 * is written in. A web booking stores the version the guest agreed to
 * (reservations.consent_version), so the version must change whenever the
 * policy's meaning does. lib/legal.test.ts pins a hash of the English text to
 * this version: editing a legal.* default fails CI until the version moves.
 * From phase 7 editors change the text in the database, and the version
 * becomes the time of that save instead of this constant.
 */
export const PRIVACY_POLICY_VERSION: IsoDate = '2026-10-02';

/** The sections of the policy page, in order: [heading, body]. */
export const PRIVACY_SECTIONS = [
  ['legal.collect_heading', 'legal.collect_body'],
  ['legal.use_heading', 'legal.use_body'],
  ['legal.share_heading', 'legal.share_body'],
  ['legal.keep_heading', 'legal.keep_body'],
  ['legal.rights_heading', 'legal.rights_body'],
] as const satisfies readonly (readonly [StringKey, StringKey])[];

/** Every key the policy page reads. */
export const PRIVACY_KEYS = ['legal.title', 'legal.updated', 'legal.intro', ...PRIVACY_SECTIONS.flat()] as const satisfies readonly StringKey[];

export function privacyHref(locale: string): string {
  return localeHref(locale, '/privacy');
}
