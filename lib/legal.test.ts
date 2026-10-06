import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REGISTRY } from '@/lib/i18n/registry';
import { AGREED_KEYS, PRIVACY_POLICY_VERSION, privacyHref } from './legal';

/*
 * reservations.consent_version must name the text the guest saw, and since
 * phase 7 the version in force is the newest legal_versions row of the
 * guest's language (migrations 009, 010), not this constant. When this test
 * fails, a code default of agreed text (legal.*, booking.consent,
 * booking.privacy_notice) changed. Do not move PRIVACY_POLICY_VERSION or edit
 * 009's seed: both describe the seeded first row, and a migration runs once
 * per database. Instead add a new migration that inserts a legal_versions row
 * per language whose text changes: English, and every language that has
 * versions but no row of its own for a changed key (its guests read the
 * English one; recordPolicyVersion hashes what each language shows). Each row
 * has version and effective_on = today's Da Nang date and text_sha256 = that
 * language's new hash (for English, the one this test prints), and ships in
 * the same deploy window as the code (the README's "Before launch A", the
 * lawyer's note). Then add that migration's English pair beside RECORDED (its
 * first row stays the seeded one) and point the assertion below at it.
 */
const RECORDED = { version: '2026-10-03', sha256: 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2' };

describe('privacy policy version', () => {
  it('pins the agreed English text (policy, notice, consent label) to the version 009 seeded: a changed default needs a new legal_versions migration', () => {
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
