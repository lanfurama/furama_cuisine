'use client';

import { MEAL_LABELS, type Meal } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';
import { RestaurantCard } from './RestaurantCard';

export function Restaurants() {
  const { site, destName, restaurants, filter, matches, shownCount, setFilter, clearFilters } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const chips: { label: string; clear: () => void }[] = [];
  if (filter.cuisine !== 'all') {
    // A cuisine no longer listed (unpublished since the filter was set) still names itself rather than nothing.
    const label = site.cuisines.find((c) => c.id === filter.cuisine)?.label ?? filter.cuisine;
    chips.push({ label, clear: () => setFilter({ cuisine: 'all' }) });
  }
  if (filter.occasion !== 'all') {
    chips.push({ label: MEAL_LABELS[filter.occasion as Meal], clear: () => setFilter({ occasion: 'all' }) });
  }
  if (filter.destination !== 'all') {
    chips.push({
      label: destName(filter.destination),
      clear: () => setFilter({ destination: 'all' }),
    });
  }

  return (
    <section id="restaurants" className="restaurants">
      <div className="shell">
        <div className="section-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            Our Restaurants
          </h2>
          <button
            ref={link}
            data-reveal="fade"
            type="button"
            className="text-link"
            onClick={clearFilters}
          >
            VIEW ALL RESTAURANTS →
          </button>
        </div>

        {chips.length > 0 && (
          <div className="filter-bar">
            <span className="filter-summary">
              {shownCount
                ? `Showing ${shownCount} of ${restaurants.length} restaurants`
                : 'No matches'}
            </span>
            {chips.map((c) => (
              <button key={c.label} type="button" className="filter-chip" onClick={c.clear}>
                {c.label}
                <span className="filter-chip-x" aria-hidden="true">
                  ×
                </span>
                <span className="sr-only">, remove filter</span>
              </button>
            ))}
            <button type="button" className="filter-clear" onClick={clearFilters}>
              CLEAR ALL
            </button>
          </div>
        )}

        <div id="restaurant-grid" className="restaurant-grid">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} hidden={!matches(r)} />
          ))}
        </div>

        {shownCount === 0 && (
          <div className="empty">
            <div className="empty-title">No restaurants match these filters</div>
            <div className="empty-lede">Try another cuisine, occasion or destination.</div>
            <button type="button" className="empty-btn" onClick={clearFilters}>
              SHOW ALL RESTAURANTS
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
