import { describe, expect, it } from 'vitest';
import { adminContentSecurityPolicy, adminSecurityHeaders, createNonce } from './csp';

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('createNonce', () => {
  it('is 128 random bits in the alphabet Next accepts', () => {
    const n = createNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(Array.from({ length: 50 }, createNonce)).size).toBe(50);
  });
});

describe('adminContentSecurityPolicy', () => {
  it('production: nonce + strict-dynamic for scripts, nonce for styles, nothing inline or eval', () => {
    const csp = adminContentSecurityPolicy('abc', { dev: false, https: true });
    const d = directives(csp);
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d['style-src']).toEqual(["'self'", "'nonce-abc'"]);
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(d['upgrade-insecure-requests']).toEqual([]);
  });

  it('http (localhost) never asks the browser to upgrade requests', () => {
    expect(adminContentSecurityPolicy('abc', { dev: false, https: false })).not.toContain('upgrade-insecure-requests');
  });

  it('next dev: eval for React error overlays, inline styles for the dev overlay', () => {
    const d = directives(adminContentSecurityPolicy('abc', { dev: true, https: false }));
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'", "'unsafe-eval'"]);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('is what Next parses the nonce from (script-src, first nonce)', () => {
    const csp = adminContentSecurityPolicy('Zm9v+/_-==', { dev: false, https: false });
    const directive = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'))!;
    expect(directive.split(/\s+/).find((s) => /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.test(s))).toBe("'nonce-Zm9v+/_-=='");
  });
});

describe('adminSecurityHeaders', () => {
  it('denies framing and indexing, keeps the referrer on the site', () => {
    expect(adminSecurityHeaders('x')).toEqual({
      'Content-Security-Policy': 'x',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
  });
});
