import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REGISTRY } from '@/lib/i18n/registry';
import { AGREED_KEYS, PRIVACY_POLICY_VERSION, privacyHref } from './legal';

/*
 * reservations.consent_version must name the text the guest saw, and since
 * phase 7 the version in force is the newest legal_versions row (migration
 * 009), not this constant. When this test fails, a code default of agreed text
 * (legal.*, booking.consent, booking.privacy_notice) changed. Do not move
 * PRIVACY_POLICY_VERSION or edit 009's seed: both describe the seeded first
 * row, and a migration runs once per database. Instead add a new migration
 * that inserts a legal_versions row (version and effective_on = today's Da
 * Nang date, text_sha256 = the new hash this test prints), shipped in the
 * same deploy window as the code (the README's "Before launch A", the
 * lawyer's note). Then pin that migration's pair here in RECORDED and compare
 * against it.
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
