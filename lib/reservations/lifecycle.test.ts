import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import {
  STAFF_SOURCES,
  TRANSITIONS,
  UPCOMING_STATUSES,
  availableTransitions,
  checkWindow,
  findTransition,
  opensAtMinutes,
  serviceDay,
  sourcesOf,
  transitionsFrom,
} from './lifecycle';

/* Spec §10.3: the transition table, its time windows, and the service day. npm test runs on UTC, like Vercel. */

// A Vietnam wall-clock time as an instant.
const at = (vn: string) => new Date(`${vn}+07:00`);
const edge = (from: Parameters<typeof findTransition>[0], to: Parameters<typeof findTransition>[1]) => {
  const t = findTransition(from, to);
  if (!t) throw new Error(`no ${from} → ${to}`);
  return t;
};

describe('the transition map', () => {
  it('is exactly the table of spec §10.3', () => {
    expect(TRANSITIONS.map((t) => `${t.from}→${t.to}`)).toEqual([
      'requested→confirmed',
      'requested→declined',
      'requested→cancelled',
      'confirmed→cancelled',
      'confirmed→seated',
      'confirmed→no_show',
      'no_show→seated',
      'seated→confirmed',
    ]);
  });

  it('has no way out of cancelled or declined, and no edge twice', () => {
    expect(transitionsFrom('cancelled')).toEqual([]);
    expect(transitionsFrom('declined')).toEqual([]);
    const keys = TRANSITIONS.map((t) => `${t.from}→${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TRANSITIONS) expect(RESERVATION_STATUSES).toContain(t.to);
  });

  it('asks for a reason to decline or cancel, and only then', () => {
    expect(TRANSITIONS.filter((t) => t.reason === 'required').map((t) => t.to)).toEqual(['declined', 'cancelled', 'cancelled']);
  });

  it('names the guest email phase 5 will queue', () => {
    expect(edge('requested', 'confirmed').guestEmail).toEqual({ event: 'guest.confirmed', when: 'always' });
    expect(edge('requested', 'declined').guestEmail).toEqual({ event: 'guest.declined', when: 'always' });
    expect(edge('confirmed', 'cancelled').guestEmail).toEqual({ event: 'guest.cancelled', when: 'if_notify' });
    expect(edge('confirmed', 'no_show').guestEmail).toBeNull();
  });

  it('lists the sources of a target status, for the UPDATE … status = ANY($from)', () => {
    expect(sourcesOf('seated')).toEqual(['confirmed', 'no_show']);
    expect(sourcesOf('cancelled')).toEqual(['requested', 'confirmed']);
  });

  it('starts staff bookings confirmed (phone) or seated (walk-in); upcoming means requested or confirmed', () => {
    expect(STAFF_SOURCES).toEqual({ phone: 'confirmed', walk_in: 'seated' });
    expect(UPCOMING_STATUSES).toEqual(['requested', 'confirmed']);
  });
});

describe('time windows', () => {
  it('"Đã đến" opens 60 minutes before the sitting, with no end', () => {
    const seat = edge('confirmed', 'seated');
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-02T17:59'))).toEqual({ ok: false, code: 'too_early' });
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-02T18:00'))).toEqual({ ok: true });
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-03T22:00'))).toEqual({ ok: true });
  });

  it('no-show only once 15 minutes have passed', () => {
    const noShow = edge('confirmed', 'no_show');
    expect(checkWindow(noShow, '2026-10-02', '19:00', at('2026-10-02T19:14'))).toEqual({ ok: false, code: 'too_early' });
    expect(checkWindow(noShow, '2026-10-02', '19:00', at('2026-10-02T19:15'))).toEqual({ ok: true });
    expect(checkWindow(noShow, '2026-10-01', '19:00', at('2026-10-02T09:00'))).toEqual({ ok: true });
  });

  it('corrections only on the same service day, which runs until 04:00 the next morning', () => {
    const undo = edge('no_show', 'seated');
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-02T23:30'))).toEqual({ ok: true });
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-03T03:59'))).toEqual({ ok: true });
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-03T04:00'))).toEqual({ ok: false, code: 'too_late' });
    expect(checkWindow(edge('seated', 'confirmed'), '2026-10-03', '12:00', at('2026-10-02T12:00'))).toEqual({ ok: false, code: 'too_early' });
  });

  it('puts the service day on Vietnam’s clock, whatever the server’s zone', () => {
    // 2026-10-02T17:30Z is 00:30 on 3 Oct in Vietnam: still the service day of 2 Oct.
    expect(serviceDay(new Date('2026-10-02T17:30:00Z'))).toBe('2026-10-02');
    // 2026-10-02T21:00Z is 04:00 on 3 Oct in Vietnam: a new service day.
    expect(serviceDay(new Date('2026-10-02T21:00:00Z'))).toBe('2026-10-03');
  });

  it('gives the minute a window opens, for the hint beside a disabled button', () => {
    expect(opensAtMinutes(edge('confirmed', 'seated'), '19:00')).toBe(18 * 60);
    expect(opensAtMinutes(edge('confirmed', 'no_show'), '19:00')).toBe(19 * 60 + 15);
    expect(opensAtMinutes(edge('no_show', 'seated'), '19:00')).toBeNull();
  });

  it('lists what a booking offers now, each with its window', () => {
    expect(availableTransitions('confirmed', '2026-10-02', '19:00', at('2026-10-02T18:30')).map((o) => [o.transition.to, o.window.ok])).toEqual([
      ['cancelled', true],
      ['seated', true],
      ['no_show', false],
    ]);
    expect(availableTransitions('declined', '2026-10-02', '19:00', at('2026-10-02T18:30'))).toEqual([]);
  });
});
