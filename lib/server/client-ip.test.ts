import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  const ip = (value?: string) => clientIp(new Headers(value === undefined ? {} : { 'x-forwarded-for': value }));

  it('takes the first X-Forwarded-For address, trimmed', () => {
    expect(ip('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    expect(ip('  2001:db8::1 ')).toBe('2001:db8::1');
  });

  it('is null without the header, or when the first entry is not an address inet accepts', () => {
    expect(ip()).toBeNull();
    expect(ip('')).toBeNull();
    expect(ip('unknown, 203.0.113.9')).toBeNull();
    // isIP() accepts an IPv6 zone id; Postgres inet does not, and the audit insert would roll the action back.
    expect(ip('fe80::1%lo0')).toBeNull();
  });
});
