'use client';

import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown } from '@/components/ui/Dropdown';

/** The desktop booking finder that sits under the hero. */
export function Finder() {
  const { site, finder, setFinder, applyFinder } = useSite();

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
            options={cuisineOptions(site.cuisines)}
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
            options={destinationOptions(site.destinations)}
          />
        </div>

        <button type="button" className="btn-green finder-submit" onClick={applyFinder}>
          SHOW RESTAURANTS<span className="arrow">→</span>
        </button>
      </div>
    </section>
  );
}
