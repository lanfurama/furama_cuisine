'use client';

import type { Restaurant } from '@/lib/data';
import { formatMessage } from '@/lib/i18n/format';
import { restaurantHref } from '@/lib/i18n/href';
import { CmsImage } from '@/components/ui/CmsImage';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/**
 * Shared grid/rail card. The hover tag and image push-in are CSS-driven so the
 * whole grid does not re-render on pointer move. A restaurant with a page is a
 * real link to it (crawlers and a new tab follow the href; a plain click keeps
 * the curtain of openRestaurant); one without stays a button that reserves or calls.
 */
export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
  const { openRestaurant, strings, locale } = useSite();
  const ref = useReveal<HTMLButtonElement & HTMLAnchorElement>('card');
  // A card without a page reserves; with online booking off (R14) it calls instead (R20), and with
  // no number either it has no action (GX-6).
  const calls = !restaurant.hasDetailPage && !restaurant.bookingEnabled && restaurant.phone !== null;
  const tag = restaurant.hasDetailPage
    ? strings['restaurants.card_view']
    : restaurant.bookingEnabled
      ? strings['restaurants.card_reserve']
      : restaurant.phone
        ? formatMessage(strings['booking.call_tag'], { phone: restaurant.phone.display }, locale)
        : null;

  const body = (
    <>
      <span className="rcard-frame frame" data-reveal-img="1">
        <span className="rcard-zoom" data-reveal-zoom="1">
          {/* alt: the card picture's own (media_i18n; seeded as the restaurant's name, R19). */}
          {restaurant.image && (
            <CmsImage
              media={restaurant.image}
              fill
              sizes="(max-width: 759px) 50vw, (max-width: 1079px) 33vw, 320px"
              className="rcard-img"
            />
          )}
        </span>
        {/* The call tag holds a whole phone number, longer than the narrowest cards: it wraps (home.css), and a
            no-break space keeps the arrow on the number's last line. VIEW and RESERVE keep their plain space. */}
        {tag && <span className={calls ? 'rcard-tag rcard-tag-call' : 'rcard-tag'}>{tag}{calls ? '\u00a0→' : ' →'}</span>}
      </span>
      <span className="rcard-name">{restaurant.name}</span>
      <span className="rcard-type">{restaurant.type}</span>
    </>
  );

  if (restaurant.hasDetailPage) {
    return (
      <a
        ref={ref}
        data-reveal="card"
        href={restaurantHref(locale, restaurant.slug)}
        className="rcard"
        hidden={hidden}
        onClick={(e) => {
          // A new tab or window (modifier keys, middle click) is the browser's; a plain click keeps the curtain.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          openRestaurant(restaurant);
        }}
      >
        {body}
      </a>
    );
  }

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
      {body}
    </button>
  );
}
