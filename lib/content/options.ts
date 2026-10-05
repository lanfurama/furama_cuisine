import { MEALS, type Meal, type Restaurant } from '@/lib/data';
import type { ClientKey } from '@/lib/i18n/registry';
import type { Cuisine, Destination } from './types';

/*
 * The option lists of the finder (desktop dropdowns and the phone sheet) and
 * of the booking bar and drawer, from the content the (guarded) layout loaded
 * (spec §6.3 item 2: a filter's value is the key, its label the text in the
 * page's language). Plain { value, label } pairs, the shape
 * components/ui/Dropdown's Option takes. The "All …"/"Any …" labels and the
 * meal names are registry keys (finder.*, meal.*), passed in from the
 * SiteProvider's strings.
 */

type Choice = { value: string; label: string };
type Strings = Record<ClientKey, string>;

/** The registry key of each service's display name (service_periods.meal is the key, never the words). */
export const MEAL_KEYS = {
  Breakfast: 'meal.breakfast',
  Lunch: 'meal.lunch',
  Dinner: 'meal.dinner',
  Drinks: 'meal.drinks',
} as const satisfies Record<Meal, ClientKey>;

export const mealLabel = (strings: Strings, meal: Meal): string => strings[MEAL_KEYS[meal]];

export const cuisineOptions = (cuisines: readonly Cuisine[], strings: Strings): Choice[] => [
  { value: 'all', label: strings['finder.all_cuisines'] },
  ...cuisines.map((c) => ({ value: c.id, label: c.label })),
];

export const occasionOptions = (strings: Strings): Choice[] => [
  { value: 'all', label: strings['finder.any_occasion'] },
  ...MEALS.map((m) => ({ value: m, label: mealLabel(strings, m) })),
];

/** The places restaurants are at: venues with a name (a teaser card such as "Future Locations" is not one). */
const venues = (destinations: readonly Destination[]): Choice[] =>
  destinations.flatMap((d) => (d.kind === 'venue' && d.name ? [{ value: d.id, label: d.name }] : []));

export const destinationOptions = (destinations: readonly Destination[], strings: Strings): Choice[] => [
  { value: 'all', label: strings['finder.any_destination'] },
  ...venues(destinations),
];

/** The booking form's places: only those with a restaurant that takes bookings online (booking_enabled). */
export const bookableDestinationOptions = (destinations: readonly Destination[], bookable: readonly Pick<Restaurant, 'dest'>[]): Choice[] =>
  venues(destinations).filter((d) => bookable.some((r) => r.dest === d.value));
