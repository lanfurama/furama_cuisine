'use client';

import { CUISINES, DESTS, DEST_KEYS, MEALS } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';

export const cuisineOptions = (): Option<string>[] => [
  { value: 'all', label: 'All cuisines' },
  ...CUISINES.map(([label]) => ({ value: label, label })),
];

export const occasionOptions = (): Option<string>[] => [
  { value: 'all', label: 'Any occasion' },
  ...MEALS.map((m) => ({ value: m, label: m })),
];

export const destinationOptions = (): Option<string>[] => [
  { value: 'all', label: 'Any destination' },
  ...DEST_KEYS.map((k) => ({ value: k, label: DESTS[k] })),
];

/** The desktop booking finder that sits under the hero. */
export function Finder() {
  const { finder, setFinder, applyFinder } = useSite();

  return (
    <section className="finder" aria-label="Find a restaurant">
      <div className="shell-wide finder-inner">
        <div className="finder-fields">
          <Dropdown
            id="fLocation"
            label="Location"
            value={finder.location}
            onPick={(location) => setFinder({ location })}
            options={[
              { value: 'Da Nang', label: 'Da Nang' },
              { value: 'soon', label: 'More cities', note: 'Coming soon', disabled: true },
            ]}
          />
          <Dropdown
            id="fCuisine"
            label="Cuisine"
            value={finder.cuisine}
            onPick={(cuisine) => setFinder({ cuisine })}
            options={cuisineOptions()}
          />
          <Dropdown
            id="fOccasion"
            label="Occasion"
            value={finder.occasion}
            onPick={(occasion) => setFinder({ occasion })}
            options={occasionOptions()}
          />
          <Dropdown
            id="fDestination"
            label="Destination"
            value={finder.destination}
            onPick={(destination) => setFinder({ destination })}
            options={destinationOptions()}
          />
        </div>

        <button type="button" className="btn-green finder-submit" onClick={applyFinder}>
          SHOW RESTAURANTS<span className="arrow">→</span>
        </button>
      </div>
    </section>
  );
}
