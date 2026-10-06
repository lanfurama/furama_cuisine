import { describe, expect, it } from 'vitest';
import { siteOrigin } from './site-origin';

describe('siteOrigin (R8-9)', () => {
  it('takes SITE_URL first, as an origin', () => {
    expect(siteOrigin({ SITE_URL: 'https://dining.furamavietnam.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).href).toBe(
      'https://dining.furamavietnam.com/',
    );
    expect(siteOrigin({ SITE_URL: ' https://dining.furamavietnam.com/en?x=1 ' }).href).toBe('https://dining.furamavietnam.com/');
  });

  it('then the production deployment Vercel names, over https', () => {
    expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'furama-cuisine.vercel.app' }).href).toBe('https://furama-cuisine.vercel.app/');
  });

  it('else this machine', () => {
    expect(siteOrigin({}).href).toBe('http://localhost:3000/');
    expect(siteOrigin({ SITE_URL: '  ', VERCEL_PROJECT_PRODUCTION_URL: '' }).href).toBe('http://localhost:3000/');
  });
});
