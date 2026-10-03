import { describe, expect, it } from 'vitest';
import * as DATA from './data';
import { FALLBACK_PHONE, MEALS, MEAL_LABELS } from './data';

describe('lib/data.ts holds code, not content (R1)', () => {
  it('exports only the meal keys and their labels, the phase-1 slots and the fallback phone', () => {
    // The content lives in the database since phase 6 (migration 008); test/fixtures/phase5-content.ts keeps what it was.
    expect(Object.keys(DATA).sort()).toEqual(['FALLBACK_PHONE', 'MEALS', 'MEAL_LABELS', 'SLOTS']);
  });
});

describe('meal labels', () => {
  it('has display text for every meal key', () => {
    for (const meal of MEALS) expect(MEAL_LABELS[meal]).toBe(meal);
  });
});

describe('FALLBACK_PHONE', () => {
  it('is a dialable E.164 number, printed with the spaces the footer prints', () => {
    expect(FALLBACK_PHONE.tel).toMatch(/^\+[1-9][0-9]{6,14}$/);
    expect(FALLBACK_PHONE.display.replace(/ /g, '')).toBe(FALLBACK_PHONE.tel);
  });
});
