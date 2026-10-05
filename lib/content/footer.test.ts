import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGISTRY } from '@/lib/i18n/registry';
import { footerVenueText, SOCIAL_PLATFORMS, socialKey } from './footer';

const PHONE = { tel: '+842363847333', display: '+84 236 3847 333' };

describe('the footer (plan 7B B5)', () => {
  it('names every platform migration 008 allows, each by its registry key (R11, L7-15)', () => {
    const migration = readFileSync('db/migrations/008_content.sql', 'utf8');
    const allowed = /CHECK \(platform IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? '';
    expect([...allowed.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...SOCIAL_PLATFORMS]);
    // Today's labels, pixel for pixel: the footer printed these from code before phase 7.
    expect(SOCIAL_PLATFORMS.map((p) => REGISTRY[socialKey(p)].en)).toEqual([
      'FACEBOOK',
      'INSTAGRAM',
      'YOUTUBE',
      'TIKTOK',
      'ZALO',
      'X',
      'TRIPADVISOR',
      'WECHAT',
      'KAKAOTALK',
      'LINE',
    ]);
  });

  it('writes a venue line as before: "name · address · " ahead of its phone', () => {
    expect(footerVenueText({ name: 'Furama Resort Danang', address: '105 Vo Nguyen Giap', phone: PHONE })).toBe('Furama Resort Danang · 105 Vo Nguyen Giap · ');
    expect(footerVenueText({ name: 'Furama Resort Danang', address: '105 Vo Nguyen Giap', phone: null })).toBe('Furama Resort Danang · 105 Vo Nguyen Giap');
  });

  it('never starts or ends a venue line with a stray separator (L7-7)', () => {
    expect(footerVenueText({ name: null, address: null, phone: PHONE })).toBe('');
    expect(footerVenueText({ name: null, address: '105 Vo Nguyen Giap', phone: PHONE })).toBe('105 Vo Nguyen Giap · ');
    expect(footerVenueText({ name: 'Dining House', address: '  ', phone: null })).toBe('Dining House');
  });
});
