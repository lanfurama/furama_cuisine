import 'server-only';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { GoogleLanguageModelOptions } from '@ai-sdk/google';
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { AuthClient, ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import type { FeatureConfig } from '@/lib/admin/ai-schemas';
import { fakeModel } from './fake';
import { resolveAiMode } from './mode';
import { modelById, type ModelId } from './models';

type Env = Record<string, string | undefined>;
type KeyCredentials = { credentials: { client_email: string; private_key: string } };

/*
 * Keyless Vertex auth (spec §9.1): the deployment's Vercel OIDC token is
 * exchanged at Google STS through Workload Identity Federation, then the
 * service account (roles/aiplatform.user) is impersonated. The supplier is a
 * wrapper on purpose: called with GCP's audience, getVercelOidcToken would read
 * it as its own and make another request (spike gotcha 2). The fallback is a
 * service-account key in GCP_SERVICE_ACCOUNT_KEY, never in the database; it is
 * used only when WIF is not fully configured.
 */
export function vertexAuth(
  env: Env = process.env,
  deps: { getToken?: () => Promise<string>; fetchImplementation?: typeof fetch } = {},
): AuthClient | KeyCredentials {
  if (env.GCP_SERVICE_ACCOUNT_KEY && !env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    const key = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY) as { client_email: string; private_key: string };
    return { credentials: { client_email: key.client_email, private_key: key.private_key } };
  }
  const getToken = deps.getToken ?? (() => getVercelOidcToken());
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    subject_token_supplier: { getSubjectToken: () => getToken() },
    ...(deps.fetchImplementation ? { transporterOptions: { fetchImplementation: deps.fetchImplementation } } : {}),
  });
  if (!client) throw new Error('WIF configuration rejected by google-auth-library');
  return client;
}

export class AiOffError extends Error {
  constructor(readonly missing: string[]) {
    super('AI is not configured');
  }
}

/** A fresh provider per request (spec §9.1), from the feature's settings. */
export function languageModel(cfg: FeatureConfig, env: Env = process.env, deps: { authClient?: AuthClient; fetch?: typeof fetch } = {}): LanguageModel {
  const mode = resolveAiMode(env);
  if (mode.mode === 'fake') return fakeModel(cfg.model);
  if (mode.mode === 'off') throw new AiOffError(mode.missing);
  const auth = deps.authClient ?? vertexAuth(env);
  const googleAuthOptions = auth instanceof AuthClient ? { authClient: auth } : { credentials: auth.credentials, projectId: env.GCP_PROJECT_ID };
  const common = { project: env.GCP_PROJECT_ID!, location: cfg.region, googleAuthOptions, fetch: deps.fetch };
  return modelById(cfg.model as ModelId).provider === 'anthropic' ? createVertexAnthropic(common)(cfg.model) : createGoogleVertex(common)(cfg.model);
}

type Level = FeatureConfig['reasoning'];
export function providerOptions(cfg: FeatureConfig): {
  anthropic?: { structuredOutputMode: 'outputFormat'; effort: Exclude<Level, 'minimal'> };
  vertex?: { thinkingConfig: { thinkingLevel: Level } };
} {
  if (modelById(cfg.model as ModelId).provider === 'anthropic') {
    return { anthropic: { structuredOutputMode: 'outputFormat', effort: cfg.reasoning === 'minimal' ? 'low' : cfg.reasoning } satisfies AnthropicLanguageModelOptions };
  }
  // Gemini 3.8 Flash rejects thinkingLevel 'minimal'.
  const thinkingLevel = cfg.reasoning === 'minimal' && cfg.model === 'gemini-3.8-flash' ? 'low' : cfg.reasoning;
  return { vertex: { thinkingConfig: { thinkingLevel } } satisfies GoogleLanguageModelOptions };
}
