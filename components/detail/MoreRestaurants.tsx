'use client';

import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';
import { RestaurantCard } from '@/components/home/RestaurantCard';

/**
 * The other restaurants at the same destination; hidden when there are none
 * (spec §6.4). The list is the catalogue every page already has; the
 * destination's name comes with the page. e2e/page-scope.spec.ts injects its
 * fault through the restaurants.find() below, so keep that call.
 */
export function MoreRestaurants({ slug, destinationName }: { slug: string; destinationName: string }) {
  const { restaurants, clearFilters, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const current = restaurants.find((r) => r.slug === slug);
  const others = current ? restaurants.filter((r) => r.dest === current.dest && r.id !== current.id) : [];
  if (!current || others.length === 0) return null;

  return (
    <section className="more">
      <div className="shell">
        <div className="section-head">
          <h2 ref={title} data-reveal="title" className="section-title more-title">
            More at {destinationName}
          </h2>
          <button
            ref={link}
            data-reveal="fade"
            type="button"
            className="text-link"
            onClick={() => {
              clearFilters();
              scrollToId('restaurants');
            }}
          >
            ALL RESTAURANTS →
          </button>
        </div>

        <div className="more-rail">
          {others.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} />
          ))}
        </div>
      </div>
    </section>
  );
}
