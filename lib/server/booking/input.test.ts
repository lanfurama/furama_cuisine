import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { honeypotFilled, parseReservationInput } from './input';

const valid = {
  restaurant: 'taya-house',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: '  Nguyễn Minh Anh ',
  phone: '0905 000 000',
  email: '',
  note: ' window seat ',
  consent: true,
  honeypot: '',
};

describe('parseReservationInput', () => {
  it('trims, normalises the phone and defaults the locale', () => {
    expect(parseReservationInput(valid)).toEqual({
      ok: true,
      value: {
        restaurantId: 'taya-house',
        date: '2026-10-05',
        time: '19:00',
        guests: 2,
        name: 'Nguyễn Minh Anh',
        phone: '0905 000 000',
        phoneE164: '+84905000000',
        email: null,
        note: 'window seat',
        locale: 'en',
        consentVersion: PRIVACY_POLICY_VERSION,
        offerId: null,
      },
    });
  });

  it('carries the offer the form was opened from (R9: reservations.offer_id)', () => {
    expect(parseReservationInput({ ...valid, offerId: 3 })).toMatchObject({ ok: true, value: { offerId: 3 } });
    expect(parseReservationInput({ ...valid, offerId: 2 ** 31 - 1 })).toMatchObject({ ok: true, value: { offerId: 2 ** 31 - 1 } });
  });

  // A soft link (R9): a bad id costs the link, never the booking, and never names a field.
  it.each([['3'], [0], [-1], [1.5], [2 ** 31], [null], [{ id: 3 }]])('books without an offerId of %j', (offerId) => {
    expect(parseReservationInput({ ...valid, offerId })).toMatchObject({ ok: true, value: { offerId: null } });
  });

  it.each([
    [{ restaurant: '' }, 'restaurant_unavailable'],
    [{ date: '2026-02-30' }, 'outside_window'],
    [{ date: '05/10/2026' }, 'outside_window'],
    [{ time: '19:5' }, 'slot_unavailable'],
    [{ guests: '2' }, 'unknown'],
    [{ guests: 0 }, 'unknown'],
    [{ name: 'A' }, 'invalid_name'],
    [{ phone: '12 34' }, 'invalid_phone'],
    [{ phone: '0000 0000 00' }, 'invalid_phone'],
    [{ email: 'a@b' }, 'invalid_email'],
    // One "@" only (R13): the outbox could never send to it.
    [{ email: 'a@b@c.vn' }, 'invalid_email'],
    [{ email: 'an@home@example.com' }, 'invalid_email'],
    [{ note: 'x'.repeat(1001) }, 'unknown'],
    [{ locale: 'x'.repeat(36) }, 'unknown'],
    [{ consent: false }, 'consent_required'],
    [{ consent: undefined }, 'consent_required'],
    [{ consent: 'true' }, 'consent_required'],
  ])('%j → %s', (over, code) => {
    expect(parseReservationInput({ ...valid, ...over })).toEqual({ ok: false, code });
  });

  it('reports the first bad field in form order', () => {
    expect(parseReservationInput({ ...valid, name: '', phone: '', email: 'x' })).toEqual({ ok: false, code: 'invalid_name' });
  });

  it('leaves a large party to max_party (no upper bound here)', () => {
    expect(parseReservationInput({ ...valid, guests: 40 })).toMatchObject({ ok: true, value: { guests: 40 } });
  });

  it('refuses anything that is not the form object', () => {
    expect(parseReservationInput(null)).toEqual({ ok: false, code: 'unknown' });
    expect(parseReservationInput('taya-house')).toEqual({ ok: false, code: 'unknown' });
  });

  // The public action reads up to Next's 1 MB body: a pattern that runs on an
  // oversized field would block the event loop for minutes (SEC-1).
  it.each([
    ['100k “@”', { email: '@'.repeat(100_000) }, 'invalid_email'],
    ['a run of dots between two “@”', { email: 'a@' + '.'.repeat(100_000) + '@' }, 'invalid_email'],
    ['100k digits', { phone: '1'.repeat(100_000) }, 'invalid_phone'],
  ])('refuses an oversized field at once: %s', (_label, over, code) => {
    const started = performance.now();
    const result = parseReservationInput({ ...valid, ...over });
    const ms = performance.now() - started;
    expect(result).toEqual({ ok: false, code });
    expect(ms).toBeLessThan(250);
  });
});

describe('consent (spec §11)', () => {
  it('books only with the box ticked, and stamps the policy version this server shows', () => {
    const { consent: _consent, ...unticked } = valid;
    expect(parseReservationInput(unticked)).toEqual({ ok: false, code: 'consent_required' });
    expect(parseReservationInput(valid)).toMatchObject({ ok: true, value: { consentVersion: PRIVACY_POLICY_VERSION } });
  });

  it('a field above the box still comes first (form order)', () => {
    expect(parseReservationInput({ ...valid, phone: '12', consent: false })).toEqual({ ok: false, code: 'invalid_phone' });
  });
});

describe('honeypotFilled (step 1)', () => {
  it.each([
    ['a URL', true, { ...valid, honeypot: 'http://spam.example' }],
    ['a space', true, { ...valid, honeypot: ' ' }],
    ['a number', true, { ...valid, honeypot: 0 }],
    ['false', true, { ...valid, honeypot: false }],
    ['empty', false, { ...valid, honeypot: '' }],
    ['undefined', false, { ...valid, honeypot: undefined }],
    ['null', false, { ...valid, honeypot: null }],
    ['no field at all', false, (({ honeypot: _h, ...rest }) => rest)(valid)],
    ['no object', false, null],
    ['a string body', false, 'honeypot'],
  ])('%s → %s', (_label, filled, input) => {
    expect(honeypotFilled(input)).toBe(filled);
  });

  it('zod still refuses a filled one, should step 1 ever be skipped', () => {
    expect(parseReservationInput({ ...valid, honeypot: 'x' })).toEqual({ ok: false, code: 'bot_blocked' });
  });
});
