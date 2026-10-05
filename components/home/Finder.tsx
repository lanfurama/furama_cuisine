'use client';

import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown } from '@/components/ui/Dropdown';

/** The desktop booking finder that sits under the hero. */
export function Finder() {
  const { site, finder, setFinder, applyFinder, strings } = useSite();

  return (
    <section className="finder" aria-label={strings['finder.title']}>
      <div className="shell-wide finder-inner">
        <div className="finder-fields">
          <Dropdown
            id="fLocation"
            label={strings['finder.location']}
            value={finder.location}
            onPick={(location) => setFinder({ location })}
            options={[
              { value: 'danang', label: strings['finder.city'] },
              { value: 'soon', label: strings['finder.more_cities'], note: strings['common.coming_soon'], disabled: true },
            ]}
          />
          <Dropdown
            id="fCuisine"
            label={strings['finder.cuisine']}
            value={finder.cuisine}
            onPick={(cuisine) => setFinder({ cuisine })}
            options={cuisineOptions(site.cuisines, strings)}
          />
          <Dropdown
            id="fOccasion"
            label={strings['finder.occasion']}
            value={finder.occasion}
            onPick={(occasion) => setFinder({ occasion })}
            options={occasionOptions(strings)}
          />
          <Dropdown
            id="fDestination"
            label={strings['finder.destination']}
            value={finder.destination}
            onPick={(destination) => setFinder({ destination })}
            options={destinationOptions(site.destinations, strings)}
          />
        </div>

        <button type="button" className="btn-green finder-submit" onClick={applyFinder}>
          {strings['finder.submit']}
          <span className="arrow">→</span>
        </button>
      </div>
    </section>
  );
}
