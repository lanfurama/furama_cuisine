import { describe, expect, it } from 'vitest';
import { envStatus, resolveAiMode, wifComplete } from './mode';

const GCP = { GCP_PROJECT_ID: 'p', GCP_PROJECT_NUMBER: '1', GCP_SERVICE_ACCOUNT_EMAIL: 'sa@p.iam.gserviceaccount.com', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel' };

describe('resolveAiMode', () => {
  it('is vertex when every WIF id is set', () => expect(resolveAiMode(GCP)).toEqual({ mode: 'vertex' }));
  it('is vertex with only the key fallback and the project', () =>
    expect(resolveAiMode({ GCP_PROJECT_ID: 'p', GCP_SERVICE_ACCOUNT_KEY: '{}' })).toEqual({ mode: 'vertex' }));
  it('is off and names what is missing', () =>
    expect(resolveAiMode({ GCP_PROJECT_ID: 'p' })).toEqual({ mode: 'off', missing: ['GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'] }));
  it('is off with every name missing when nothing is set', () => {
    const m = resolveAiMode({});
    expect(m.mode).toBe('off');
    expect(m.mode === 'off' && m.missing).toHaveLength(5);
  });
  it('is fake when asked, except on Production', () => {
    expect(resolveAiMode({ AI_PROVIDER: 'fake' })).toEqual({ mode: 'fake' });
    expect(() => resolveAiMode({ AI_PROVIDER: 'fake', VERCEL_ENV: 'production' })).toThrow(/production/i);
  });
  it('accepts AI_PROVIDER=vertex only with the env present', () => {
    expect(resolveAiMode({ ...GCP, AI_PROVIDER: 'vertex' })).toEqual({ mode: 'vertex' });
    expect(resolveAiMode({ AI_PROVIDER: 'vertex' }).mode).toBe('off');
  });
  it('refuses GOOGLE_VERTEX_API_KEY in every mode', () => {
    expect(() => resolveAiMode({ ...GCP, GOOGLE_VERTEX_API_KEY: 'k' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
    expect(() => resolveAiMode({ AI_PROVIDER: 'fake', GOOGLE_VERTEX_API_KEY: 'k' })).toThrow();
    expect(() => resolveAiMode({ GOOGLE_VERTEX_API_KEY: 'k' })).toThrow();
  });
  it('refuses GOOGLE_VERTEX_API_KEY on presence, even blank', () => {
    expect(() => resolveAiMode({ ...GCP, GOOGLE_VERTEX_API_KEY: '   ' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
    expect(() => resolveAiMode({ ...GCP, GOOGLE_VERTEX_API_KEY: '' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
  });
  it('refuses an unknown AI_PROVIDER', () => expect(() => resolveAiMode({ AI_PROVIDER: 'openai' })).toThrow());
});

describe('envStatus', () => {
  it('reports presence, never values', () => {
    const s = envStatus({ ...GCP, GCP_SERVICE_ACCOUNT_KEY: 'secret' });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(s.find((x) => x.name === 'GCP_SERVICE_ACCOUNT_KEY')).toEqual({ name: 'GCP_SERVICE_ACCOUNT_KEY', present: true });
    expect(s.find((x) => x.name === 'GCP_PROJECT_ID')).toEqual({ name: 'GCP_PROJECT_ID', present: true });
    expect(envStatus({}).every((x) => !x.present)).toBe(true);
  });
});

describe('wifComplete', () => {
  it('needs all five ids, non-blank', () => {
    expect(wifComplete(GCP)).toBe(true);
    expect(wifComplete({ ...GCP, GCP_PROJECT_NUMBER: '  ' })).toBe(false);
    expect(wifComplete({ GCP_PROJECT_ID: 'p', GCP_WORKLOAD_IDENTITY_POOL_ID: 'v' })).toBe(false);
  });
});
