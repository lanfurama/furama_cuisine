import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSchema, type AiSettings } from '@/lib/admin/ai-schemas';

let settings: () => Promise<AiSettings>;
vi.mock('./settings', () => ({ cachedAiSettings: () => settings() }));

import { loadAiFeatures } from './features';

const ALL_OFF = { translate: false, assist: false, seo: false, alt: false };

describe('loadAiFeatures', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('follows the feature switches when AI is on', async () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    settings = async () => AiSettingsSchema.parse({ features: { seo: { enabled: false } } });
    expect(await loadAiFeatures()).toEqual({ translate: true, assist: true, seo: false, alt: true });
  });

  it('is all false when AI is not configured', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    for (const n of ['GCP_PROJECT_ID', 'GCP_SERVICE_ACCOUNT_KEY', 'GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID']) vi.stubEnv(n, '');
    settings = async () => AiSettingsSchema.parse({});
    expect(await loadAiFeatures()).toEqual(ALL_OFF);
  });

  it('is all false, not a crash, when the configuration is refused or the settings cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('AI_PROVIDER', 'fake');
    vi.stubEnv('GOOGLE_VERTEX_API_KEY', 'secret-value');
    settings = async () => AiSettingsSchema.parse({});
    expect(await loadAiFeatures()).toEqual(ALL_OFF);
    vi.unstubAllEnvs();
    vi.stubEnv('AI_PROVIDER', 'fake');
    settings = async () => {
      throw new Error('connection to db-host with secret-value failed');
    };
    expect(await loadAiFeatures()).toEqual(ALL_OFF);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
    log.mockRestore();
  });
});
