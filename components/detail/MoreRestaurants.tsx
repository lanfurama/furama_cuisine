'use client';

import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';
import { RestaurantCard } from '@/components/home/RestaurantCard';

export function MoreRestaurants() {
  const { restaurants, clearFilters, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const others = restaurants.filter((r) => r.dest === 'resort' && r.id !== 'taya-house');

  return (
    <section className="more">
      <div className="shell">
        <div className="section-head">
          <h2 ref={title} data-reveal="title" className="section-title more-title">
            More at Furama Resort Danang
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
