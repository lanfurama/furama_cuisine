import { describe, expect, it } from 'vitest';
import { MODELS, modelById, priceUsd } from './models';

describe('model catalogue', () => {
  it('defaults to gemini-3.8-flash on global', () => {
    expect(MODELS[0]).toMatchObject({ id: 'gemini-3.8-flash', provider: 'google', regions: ['global', 'us', 'eu'] });
  });
  it('prices a call per million tokens, +10% outside global', () => {
    expect(priceUsd('gemini-3.8-flash', 'global', 1_000_000, 0)).toBeCloseTo(1.5);
    expect(priceUsd('gemini-3.8-flash', 'eu', 0, 1_000_000)).toBeCloseTo(8.25);
  });
  it('knows every Claude model as anthropic with images and structured output', () => {
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const) {
      expect(modelById(id)).toMatchObject({ provider: 'anthropic', image: true, structured: true });
    }
  });
  it('throws on an unknown model', () => expect(() => modelById('gpt-x' as never)).toThrow());
});
