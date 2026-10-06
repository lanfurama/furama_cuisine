'use client';

import type { Meal } from '@/lib/data';
import { cuisineLabel, mealLabel } from '@/lib/content/options';
import { formatMessage } from '@/lib/i18n/format';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';
import { RestaurantCard } from './RestaurantCard';

export function Restaurants() {
  const { site, destName, restaurants, filter, matches, shownCount, setFilter, clearFilters, strings, locale } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const chips: { label: string; clear: () => void }[] = [];
  if (filter.cuisine !== 'all') {
    chips.push({ label: cuisineLabel(site.cuisines, filter.cuisine), clear: () => setFilter({ cuisine: 'all' }) });
  }
  if (filter.occasion !== 'all') {
    chips.push({ label: mealLabel(strings, filter.occasion as Meal), clear: () => setFilter({ occasion: 'all' }) });
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
            {strings['restaurants.title']}
          </h2>
          <button
            ref={link}
            data-reveal="fade"
            type="button"
            className="text-link"
            onClick={clearFilters}
          >
            {`${strings['restaurants.view_all']} →`}
          </button>
        </div>

        {chips.length > 0 && (
          <div className="filter-bar">
            <span className="filter-summary">
              {shownCount
                ? formatMessage(strings['restaurants.showing'], { shown: shownCount, total: restaurants.length }, locale)
                : strings['restaurants.no_matches']}
            </span>
            {chips.map((c) => (
              <button key={c.label} type="button" className="filter-chip" onClick={c.clear}>
                {c.label}
                <span className="filter-chip-x" aria-hidden="true">
                  ×
                </span>
                <span className="sr-only">{strings['restaurants.remove_filter_sr']}</span>
              </button>
            ))}
            <button type="button" className="filter-clear" onClick={clearFilters}>
              {strings['restaurants.clear_all']}
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
            <div className="empty-title">{strings['restaurants.empty_title']}</div>
            <div className="empty-lede">{strings['restaurants.empty_lede']}</div>
            <button type="button" className="empty-btn" onClick={clearFilters}>
              {strings['restaurants.show_all']}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
