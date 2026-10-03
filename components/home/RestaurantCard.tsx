'use client';

import type { Restaurant } from '@/lib/data';
import { CmsImage } from '@/components/ui/CmsImage';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/**
 * Shared grid/rail card. The hover tag and image push-in are CSS-driven so the
 * whole grid does not re-render on pointer move.
 */
export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
  const { openRestaurant } = useSite();
  const ref = useReveal<HTMLButtonElement>('card');
  // A card without a page only reserves: with online booking off it has no action (R14).
  const tag = restaurant.hasDetailPage ? 'View restaurant' : restaurant.bookingEnabled ? 'Reserve a table' : null;

  return (
    <button
      ref={ref}
      data-reveal="card"
      type="button"
      className="rcard"
      hidden={hidden}
      aria-disabled={tag ? undefined : true}
      onClick={() => openRestaurant(restaurant)}
    >
      <span className="rcard-frame frame" data-reveal-img="1">
        <span className="rcard-zoom" data-reveal-zoom="1">
          {/* alt: the card picture's own (media_i18n; seeded as the restaurant's name, R19). */}
          {restaurant.image && (
            <CmsImage
              media={restaurant.image}
              fill
              sizes="(max-width: 759px) 50vw, (max-width: 1079px) 33vw, 240px"
              className="rcard-img"
            />
          )}
        </span>
        {tag && <span className="rcard-tag">{tag} →</span>}
      </span>
      <span className="rcard-name">{restaurant.name}</span>
      <span className="rcard-type">{restaurant.type}</span>
    </button>
  );
}
