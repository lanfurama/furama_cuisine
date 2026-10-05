import { describe, expect, it } from 'vitest';
import { guestSettings } from './settings';
import type { SiteSettings } from './types';

const SETTINGS: SiteSettings = { email: 'cuisine@furama.test', defaultRestaurantId: 'taya-house', defaultOccasion: 'Dinner', heroAutoplayMs: 7000 };
const CATALOGUE = [{ id: 'taya-house' }, { id: 'the-fan' }];

describe('guestSettings (SEC-6, L7-2)', () => {
  it('keeps a default restaurant guests can see, with the settings’ keys in their order (the seeded payload stays byte-identical)', () => {
    const kept = guestSettings(SETTINGS, CATALOGUE);
    expect(kept).toEqual(SETTINGS);
    expect(Object.keys(kept)).toEqual(Object.keys(SETTINGS));
  });

  it('a draft, archived or hidden-destination default (not in the guest catalogue) never reaches the page: null, as if none was chosen', () => {
    const dropped = guestSettings({ ...SETTINGS, defaultRestaurantId: 'test-draft' }, CATALOGUE);
    expect(dropped).toEqual({ ...SETTINGS, defaultRestaurantId: null });
    expect(Object.keys(dropped)).toEqual(Object.keys(SETTINGS));
    expect(guestSettings(SETTINGS, [{ id: 'the-fan' }]).defaultRestaurantId).toBeNull();
  });

  it('none stays none', () => {
    expect(guestSettings({ ...SETTINGS, defaultRestaurantId: null }, CATALOGUE)).toEqual({ ...SETTINGS, defaultRestaurantId: null });
  });
});
