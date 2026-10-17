import { describe, expect, it } from 'vitest';
import { assistInstructions } from './assist';

describe('assistInstructions', () => {
  it('starts with the TASK and ACTION lines the fake model reads', () => {
    for (const action of ['rewrite', 'shorten', 'brand'] as const) {
      const lines = assistInstructions({ action, locale: 'en', brandVoice: 'Warm', systemPrompt: '' }).split('\n');
      expect(lines.slice(0, 2)).toEqual(['TASK: assist', `ACTION: ${action}`]);
    }
  });

  it('writes in the language of the tab, and asks for the text alone', () => {
    const text = assistInstructions({ action: 'rewrite', locale: 'vi', brandVoice: '', systemPrompt: '' });
    expect(text).toContain('Write in Vietnamese.');
    expect(text).toMatch(/text only/);
    expect(text).not.toContain('Brand voice');
    expect(text).not.toContain('characters');
  });

  it('carries the maximum length, the brand voice and the system prompt when there are some', () => {
    const text = assistInstructions({ action: 'brand', locale: 'en', maxLength: 300, brandVoice: 'Warm and calm', systemPrompt: 'Use British spelling.' });
    expect(text).toContain('Write in English.');
    expect(text).toContain('at most 300 characters');
    expect(text).toContain('Brand voice: Warm and calm');
    expect(text.endsWith('Use British spelling.')).toBe(true);
  });

  it('describes each action differently', () => {
    const one = (action: 'rewrite' | 'shorten' | 'brand') => assistInstructions({ action, locale: 'en', brandVoice: 'Warm', systemPrompt: '' }).split('\n')[2];
    expect(new Set([one('rewrite'), one('shorten'), one('brand')]).size).toBe(3);
    expect(one('shorten')).toMatch(/[Ss]horten/);
    expect(one('brand')).toMatch(/brand voice/);
  });
});
