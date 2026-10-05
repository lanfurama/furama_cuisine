import { describe, expect, it } from 'vitest';
import * as DATA from './data';
import { REGISTRY } from '@/lib/i18n/registry';
import { MEAL_KEYS } from '@/lib/content/options';
import { FALLBACK_PHONE, MEALS } from './data';

describe('lib/data.ts holds code, not content (R1)', () => {
  it('exports only the meal keys, the phase-1 slots and the fallback phone (meal names are registry keys)', () => {
    // The content lives in the database since phase 6 (migration 008); test/fixtures/phase5-content.ts keeps what it was.
    expect(Object.keys(DATA).sort()).toEqual(['FALLBACK_PHONE', 'MEALS', 'SLOTS']);
  });
});

describe('meal labels', () => {
  it('has a registry key for every meal, whose English text is the meal’s own name (pixel-identical to phase 6)', () => {
    for (const meal of MEALS) expect(REGISTRY[MEAL_KEYS[meal]].en).toBe(meal);
  });
});

describe('FALLBACK_PHONE', () => {
  it('is a dialable E.164 number, printed with the spaces the footer prints', () => {
    expect(FALLBACK_PHONE.tel).toMatch(/^\+[1-9][0-9]{6,14}$/);
    expect(FALLBACK_PHONE.display.replace(/ /g, '')).toBe(FALLBACK_PHONE.tel);
  });
});
