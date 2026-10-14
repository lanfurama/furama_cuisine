import { describe, expect, it } from 'vitest';
import { AiSettingsSchema } from './ai-schemas';

describe('AiSettingsSchema', () => {
  it('fills the spec defaults from {}', () => {
    const s = AiSettingsSchema.parse({});
    expect(s.budgetUsd).toBe(20);
    expect(s.limits).toEqual({ perMinute: 10, perDay: 100 });
    for (const f of ['translate', 'assist', 'seo', 'alt'] as const) {
      expect(s.features[f]).toMatchObject({ enabled: true, model: 'gemini-3.8-flash', region: 'global', reasoning: 'low' });
    }
  });
  it('refuses a region the model does not serve', () => {
    // every catalogue model serves all three today; the refine still guards a future one
    expect(AiSettingsSchema.safeParse({ features: { translate: { region: 'asia' } } }).success).toBe(false);
  });
  it('bounds tokens, prompts, limits and budget', () => {
    expect(AiSettingsSchema.safeParse({ features: { assist: { maxOutputTokens: 50_000 } } }).success).toBe(false);
    expect(AiSettingsSchema.safeParse({ limits: { perMinute: 0, perDay: 100 } }).success).toBe(false);
    expect(AiSettingsSchema.safeParse({ budgetUsd: -1 }).success).toBe(false);
    expect(AiSettingsSchema.safeParse({ brandVoice: 'x'.repeat(2001) }).success).toBe(false);
  });
});
