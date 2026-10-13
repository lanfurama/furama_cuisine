import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { AuthClient } from 'google-auth-library';
import type { FeatureConfig } from '@/lib/admin/ai-schemas';
import { AiOffError, languageModel, providerOptions, vertexAuth } from './client';

const GCP = { GCP_PROJECT_ID: 'p', GCP_PROJECT_NUMBER: '1', GCP_SERVICE_ACCOUNT_EMAIL: 'sa@p.iam.gserviceaccount.com', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel' };

const cfg = (over: Partial<FeatureConfig>): FeatureConfig => ({ enabled: true, model: 'gemini-3.8-flash', region: 'global', reasoning: 'low', maxOutputTokens: 1000, systemPrompt: '', ...over });

/* Nothing here may reach the network: any host not faked below throws, for the whole file. */
const HOSTS = ['sts.googleapis.com', 'iamcredentials.googleapis.com', 'aiplatform.googleapis.com', 'aiplatform.us.rep.googleapis.com'];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
type Seen = { url: string; headers: Headers; body: string };
const seen: Seen[] = [];
const guardedFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (!HOSTS.includes(new URL(u).host)) throw new Error(`unexpected network call to ${u}`);
  seen.push({ url: u, headers: new Headers(init?.headers), body: String(init?.body ?? '') });
  if (u === 'https://sts.googleapis.com/v1/token') return json({ access_token: 'fed', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 });
  if (u.startsWith('https://iamcredentials.googleapis.com/')) return json({ accessToken: 'sa-token', expireTime: new Date(Date.now() + 3600e3).toISOString() });
  if (u.endsWith(':generateContent'))
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
}) as typeof fetch;

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal('fetch', guardedFetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

class FakeAuthClient extends AuthClient {
  async getAccessToken() {
    return { token: 'sa-token' };
  }
  async getRequestHeaders() {
    return new Headers({ authorization: 'Bearer sa-token' });
  }
  async request(): Promise<never> {
    throw new Error('no network');
  }
}

describe('vertexAuth', () => {
  it('exchanges the Vercel OIDC token through STS and impersonates the service account', async () => {
    seen.length = 0;
    const getToken = vi.fn(async () => 'oidc-jwt');
    const client = vertexAuth(GCP, { getToken, fetchImplementation: guardedFetch });
    if (!(client instanceof AuthClient)) throw new Error('expected an auth client');
    // google-auth-library 10.9.1 builds StsCredentials with its own node-fetch transporter (spike gotcha 1).
    const internal = client as unknown as { stsCredential?: { transporter: unknown }; transporter: unknown };
    if (!internal.stsCredential) throw new Error('stsCredential not found; refusing to hit the network');
    internal.stsCredential.transporter = internal.transporter;
    expect((await client.getAccessToken()).token).toBe('sa-token');
    const sts = new URLSearchParams(seen[0].body);
    expect(sts.get('subject_token')).toBe('oidc-jwt');
    expect(sts.get('audience')).toBe('//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/vercel/providers/vercel');
    expect(getToken).toHaveBeenCalledWith();
    expect(seen[1].url).toBe('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@p.iam.gserviceaccount.com:generateAccessToken');
  });

  it('falls back to the key in GCP_SERVICE_ACCOUNT_KEY only when WIF is not configured', () => {
    const key = JSON.stringify({ client_email: 'k@p.iam.gserviceaccount.com', private_key: 'pk' });
    expect(vertexAuth({ GCP_PROJECT_ID: 'p', GCP_SERVICE_ACCOUNT_KEY: key })).toEqual({ credentials: { client_email: 'k@p.iam.gserviceaccount.com', private_key: 'pk' } });
    expect(vertexAuth({ ...GCP, GCP_SERVICE_ACCOUNT_KEY: key }, { getToken: async () => 't' })).toBeInstanceOf(AuthClient);
  });
});

describe('languageModel', () => {
  it('Gemini at global: the v1beta1 endpoint, bearer from the auth client', async () => {
    seen.length = 0;
    const model = languageModel(cfg({}), GCP, { authClient: new FakeAuthClient(), fetch: guardedFetch });
    await generateText({ model, prompt: 'ping', maxRetries: 0 });
    expect(seen[0].url).toBe('https://aiplatform.googleapis.com/v1beta1/projects/p/locations/global/publishers/google/models/gemini-3.8-flash:generateContent');
    expect(seen[0].headers.get('authorization')).toBe('Bearer sa-token');
  });

  it('Claude at us: the regional endpoint and rawPredict', async () => {
    seen.length = 0;
    const c = cfg({ model: 'claude-sonnet-5-5', region: 'us' });
    const model = languageModel(c, GCP, { authClient: new FakeAuthClient(), fetch: guardedFetch });
    await generateText({ model, prompt: 'ping', maxRetries: 0, providerOptions: providerOptions(c) });
    expect(seen[0].url).toContain('aiplatform.us.rep.googleapis.com');
    expect(seen[0].url).toContain('publishers/anthropic/models/claude-sonnet-5-5:rawPredict');
  });

  it('returns the fake model in fake mode and refuses when off', () => {
    expect(languageModel(cfg({}), { AI_PROVIDER: 'fake' }).constructor.name).toMatch(/Mock|Fake/);
    expect(() => languageModel(cfg({}), {})).toThrow(AiOffError);
  });
  it('refuses to run with GOOGLE_VERTEX_API_KEY present', () => {
    expect(() => languageModel(cfg({}), { ...GCP, GOOGLE_VERTEX_API_KEY: 'k' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
  });
});

describe('providerOptions', () => {
  it('Claude: structuredOutputMode outputFormat, and minimal reasoning is effort low', () => {
    expect(providerOptions(cfg({ model: 'claude-haiku-5-5', reasoning: 'high' })).anthropic).toEqual({ structuredOutputMode: 'outputFormat', effort: 'high' });
    expect(providerOptions(cfg({ model: 'claude-haiku-5-5', reasoning: 'minimal' })).anthropic).toMatchObject({ effort: 'low' });
  });
  it('Gemini: thinkingLevel as set, but Gemini 3.8 Flash has no minimal (low instead)', () => {
    expect(providerOptions(cfg({ model: 'gemini-3.8-flash', reasoning: 'minimal' })).vertex).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    expect(providerOptions(cfg({ model: 'gemini-3.8-flash', reasoning: 'high' })).vertex).toEqual({ thinkingConfig: { thinkingLevel: 'high' } });
    expect(providerOptions(cfg({ model: 'gemini-3.5-flash-lite', reasoning: 'minimal' })).vertex).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
  });
});
