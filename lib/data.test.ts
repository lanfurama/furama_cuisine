import { describe, expect, it } from 'vitest';
import { CONTACT, CUISINES, FALLBACK_PHONE, MEALS, MEAL_LABELS, contactFor, cuisineLabel, cuisineSlug } from './data';

describe('cuisine keys', () => {
  it('turns every label into its slug and back', () => {
    for (const [label, slug] of CUISINES) {
      expect(cuisineSlug(label)).toBe(slug);
      expect(cuisineLabel(slug)).toBe(label);
    }
    expect(cuisineSlug('Steak & Grill')).toBe('steak-grill');
  });

  it('refuses a label it does not know, so a typo in the database cannot hide a restaurant', () => {
    expect(() => cuisineSlug('Steak and Grill')).toThrow(/Unknown cuisine label/);
  });

  it('shows an unknown slug as itself rather than nothing', () => {
    expect(cuisineLabel('fusion')).toBe('fusion');
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

describe('contactFor', () => {
  it('gives the resort its phone and map, the dining house its phone only, and hides both elsewhere', () => {
    expect(contactFor('resort')).toEqual({ tel: CONTACT.resortPhone, map: CONTACT.map });
    expect(contactFor('dining-house')).toEqual({ tel: CONTACT.diningHousePhone, map: null });
    expect(contactFor('mm')).toEqual({ tel: null, map: null });
    expect(contactFor(undefined)).toEqual({ tel: null, map: null });
  });
});
