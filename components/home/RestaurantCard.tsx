'use client';

import Image from 'next/image';
import { restaurantImage, type Restaurant } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/**
 * Shared grid/rail card. The hover tag and image push-in are CSS-driven so the
 * whole grid does not re-render on pointer move.
 */
export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
  const { openRestaurant } = useSite();
  const ref = useReveal<HTMLButtonElement>('card');
  const isDetailLink = restaurant.id === 'taya-house';

  return (
    <button
      ref={ref}
      data-reveal="card"
      type="button"
      className="rcard"
      hidden={hidden}
      onClick={() => openRestaurant(restaurant)}
    >
      <span className="rcard-frame frame" data-reveal-img="1">
        <span className="rcard-zoom" data-reveal-zoom="1">
          <Image
            src={restaurantImage(restaurant.id)}
            alt={restaurant.name}
            fill
            sizes="(max-width: 759px) 50vw, (max-width: 1079px) 33vw, 240px"
            className="rcard-img"
          />
        </span>
        <span className="rcard-tag">{isDetailLink ? 'View restaurant' : 'Reserve a table'} →</span>
      </span>
      <span className="rcard-name">{restaurant.name}</span>
      <span className="rcard-type">{restaurant.type}</span>
    </button>
  );
}
