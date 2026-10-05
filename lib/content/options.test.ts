import { describe, expect, it } from 'vitest';
import type { Cuisine, Destination } from './types';
import { CLIENT_KEYS, REGISTRY, type ClientKey } from '@/lib/i18n/registry';
import { bookableDestinationOptions, cuisineOptions, destinationOptions, mealLabel, occasionOptions } from './options';

// The registry's English text, as the SiteProvider hands it to the client with no database rows.
const EN = Object.fromEntries(CLIENT_KEYS.map((k) => [k, REGISTRY[k].en])) as Record<ClientKey, string>;

const cuisine = (id: string, label: string): Cuisine => ({ id, label, image: null });
const destination = (id: string, kind: Destination['kind'], name: string | null): Destination => ({
  id,
  kind,
  name,
  cardTitle: [name ?? '', ''],
  cardBlurb: ['', ''],
  image: null,
  address: null,
  phone: null,
  map: null,
  showInFooter: false,
});

const DESTINATIONS = [
  destination('resort', 'venue', 'Furama Resort Danang'),
  destination('dining-house', 'venue', 'Furama Dining House'),
  destination('mm', 'venue', 'Furama MM Supercenter'),
  destination('future', 'teaser', null),
];

describe('the finder’s and booking form’s option lists (spec §6.3 item 2)', () => {
  it('cuisines: "All cuisines", then each cuisine by its id, named by its label, in the rail’s order', () => {
    expect(cuisineOptions([cuisine('thai', 'Thai'), cuisine('steak-grill', 'Steak & Grill')], EN)).toEqual([
      { value: 'all', label: 'All cuisines' },
      { value: 'thai', label: 'Thai' },
      { value: 'steak-grill', label: 'Steak & Grill' },
    ]);
  });

  it('occasions: "Any occasion", then the meal keys with their labels', () => {
    expect(occasionOptions(EN).map((o) => o.value)).toEqual(['all', 'Breakfast', 'Lunch', 'Dinner', 'Drinks']);
    expect(occasionOptions(EN)[0]).toEqual({ value: 'all', label: 'Any occasion' });
  });

  it('labels come from the strings handed in (meal.*, finder.*), so an edited or translated label shows', () => {
    const vi = { ...EN, 'meal.dinner': 'Bữa tối', 'finder.any_occasion': 'Mọi dịp' };
    expect(occasionOptions(vi).slice(0, 4).map((o) => o.label)).toEqual(['Mọi dịp', 'Breakfast', 'Lunch', 'Bữa tối']);
    expect(mealLabel(vi, 'Dinner')).toBe('Bữa tối');
  });

  it('destinations: the places restaurants are at, by id; a teaser card is not one', () => {
    expect(destinationOptions(DESTINATIONS, EN)).toEqual([
      { value: 'all', label: 'Any destination' },
      { value: 'resort', label: 'Furama Resort Danang' },
      { value: 'dining-house', label: 'Furama Dining House' },
      { value: 'mm', label: 'Furama MM Supercenter' },
    ]);
    // A venue whose name is not written in any language yet has nothing to show in a list.
    expect(destinationOptions([destination('pop-up', 'venue', null)], EN)).toEqual([{ value: 'all', label: 'Any destination' }]);
  });

  it('the booking form: only places with a restaurant that takes bookings online, no "any"', () => {
    expect(bookableDestinationOptions(DESTINATIONS, [{ dest: 'mm' }, { dest: 'resort' }, { dest: 'resort' }])).toEqual([
      { value: 'resort', label: 'Furama Resort Danang' },
      { value: 'mm', label: 'Furama MM Supercenter' },
    ]);
    expect(bookableDestinationOptions(DESTINATIONS, [])).toEqual([]);
  });
});
