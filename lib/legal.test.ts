import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REGISTRY, type StringKey } from '@/lib/i18n/registry';
import { PRIVACY_KEYS, PRIVACY_POLICY_VERSION, privacyHref } from './legal';

/** Everything a guest agrees to when ticking the box: the page and the drawer's notice and label. */
const AGREED_KEYS: readonly StringKey[] = [...PRIVACY_KEYS, 'booking.privacy_notice', 'booking.consent'];

/*
 * reservations.consent_version must name the text the guest saw. When this
 * test fails, the policy text changed: move PRIVACY_POLICY_VERSION to today's
 * date and record the new pair below, in the same commit.
 */
const RECORDED = { version: '2026-10-03', sha256: 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2' };

describe('privacy policy version', () => {
  it('moves whenever the English text of the policy, the notice or the consent label changes', () => {
    const text = JSON.stringify(AGREED_KEYS.map((k) => [k, REGISTRY[k].en]));
    expect({ version: PRIVACY_POLICY_VERSION, sha256: createHash('sha256').update(text).digest('hex') }).toEqual(RECORDED);
  });

  it('is a calendar date, so the page can show it', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lives under the locale prefix', () => {
    expect(privacyHref('en')).toBe('/en/privacy');
    expect(privacyHref('zh-hans')).toBe('/zh-hans/privacy');
  });

  it('is English only until a reviewed Vietnamese text exists (R17): no key the guest agrees to has a vi default', () => {
    expect(AGREED_KEYS.filter((k) => 'vi' in REGISTRY[k])).toEqual([]);
  });
});
