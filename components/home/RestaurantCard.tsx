'use client';

import type { Restaurant } from '@/lib/data';
import { formatMessage } from '@/lib/i18n/format';
import { CmsImage } from '@/components/ui/CmsImage';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/**
 * Shared grid/rail card. The hover tag and image push-in are CSS-driven so the
 * whole grid does not re-render on pointer move.
 */
export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
  const { openRestaurant, strings } = useSite();
  const ref = useReveal<HTMLButtonElement>('card');
  // A card without a page reserves; with online booking off (R14) it calls instead (R20), and with
  // no number either it has no action (GX-6).
  const calls = !restaurant.hasDetailPage && !restaurant.bookingEnabled && restaurant.phone !== null;
  const tag = restaurant.hasDetailPage
    ? 'View restaurant'
    : restaurant.bookingEnabled
      ? 'Reserve a table'
      : restaurant.phone
        ? formatMessage(strings['booking.call_tag'], { phone: restaurant.phone.display })
        : null;

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
        {/* The call tag holds a whole phone number, longer than the narrowest cards: it wraps (home.css). */}
        {tag && <span className={calls ? 'rcard-tag rcard-tag-call' : 'rcard-tag'}>{tag} →</span>}
      </span>
      <span className="rcard-name">{restaurant.name}</span>
      <span className="rcard-type">{restaurant.type}</span>
    </button>
  );
}
