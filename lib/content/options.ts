import { MEALS, MEAL_LABELS, type Restaurant } from '@/lib/data';
import type { Cuisine, Destination } from './types';

/*
 * The option lists of the finder (desktop dropdowns and the phone sheet) and
 * of the booking bar and drawer, from the content the (guarded) layout loaded
 * (spec §6.3 item 2: a filter's value is the key, its label the text in the
 * page's language). Plain { value, label } pairs, the shape
 * components/ui/Dropdown's Option takes. PHASE 7: the "All …"/"Any …" labels
 * become registry keys (finder.all_cuisines, finder.any_occasion,
 * finder.any_destination).
 */

type Choice = { value: string; label: string };

export const cuisineOptions = (cuisines: readonly Cuisine[]): Choice[] => [
  { value: 'all', label: 'All cuisines' },
  ...cuisines.map((c) => ({ value: c.id, label: c.label })),
];

export const occasionOptions = (): Choice[] => [
  { value: 'all', label: 'Any occasion' },
  ...MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
];

/** The places restaurants are at: venues with a name (a teaser card such as "Future Locations" is not one). */
const venues = (destinations: readonly Destination[]): Choice[] =>
  destinations.flatMap((d) => (d.kind === 'venue' && d.name ? [{ value: d.id, label: d.name }] : []));

export const destinationOptions = (destinations: readonly Destination[]): Choice[] => [
  { value: 'all', label: 'Any destination' },
  ...venues(destinations),
];

/** The booking form's places: only those with a restaurant that takes bookings online (booking_enabled). */
export const bookableDestinationOptions = (destinations: readonly Destination[], bookable: readonly Pick<Restaurant, 'dest'>[]): Choice[] =>
  venues(destinations).filter((d) => bookable.some((r) => r.dest === d.value));
