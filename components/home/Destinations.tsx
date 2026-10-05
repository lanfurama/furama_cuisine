'use client';

import type { Destination } from '@/lib/content/types';
import { formatMessage } from '@/lib/i18n/format';
import type { Copy } from '@/lib/i18n/registry';
import { journeyStops } from '@/lib/journey';
import { CmsImage } from '@/components/ui/CmsImage';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/** The cards come from the layout's destinations; the section's copy (destinations.*) from the page, read on the server. */
export function Destinations({ copy }: { copy: Copy<'destinations'> }) {
  const { site, restaurants, pickDestination, strings, locale } = useSite();
  // destinations and destination_i18n: the venues, then the teaser ("Future Locations"), which is not a link.
  const cards = site.destinations;
  const title = useReveal<HTMLHeadingElement>('title');
  const lede = useReveal<HTMLParagraphElement>('up');
  const journey = useReveal<HTMLDivElement>('journey');
  const { inset, stops } = journeyStops(cards.length);

  return (
    <section id="destinations" className="destinations">
      <div className="shell">
        <div className="destinations-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            {copy['destinations.title']}
          </h2>
          <p ref={lede} data-reveal="up" className="section-lede">
            {copy['destinations.lede']}
          </p>
        </div>

        {/* The dotted route line that ties the destinations together. */}
        <div ref={journey} data-reveal="journey" className="journey" aria-hidden="true">
          <div data-jline="1" className="journey-line" style={{ left: `${inset}%`, right: `${inset}%` }} />
          {stops.map((left) => (
            <span key={left} data-jdot="1" className="journey-dot" style={{ left: `${left}%` }} />
          ))}
        </div>

        <div className="dest-rail">
          {cards.map((card) => (
            <DestCard
              key={card.id}
              card={card}
              count={
                card.kind === 'teaser'
                  ? strings['common.coming_soon']
                  : `${formatMessage(copy['destinations.count'], { count: restaurants.filter((r) => r.dest === card.id).length }, locale)} →`
              }
              onPick={card.kind === 'teaser' ? undefined : () => pickDestination(card.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DestCard({
  card,
  count,
  onPick,
}: {
  card: Destination;
  count: string;
  onPick?: () => void;
}) {
  const ref = useReveal<HTMLDivElement>('clip');

  const body = (
    <>
      <span className="dest-zoom" data-reveal-zoom="1">
        {/* Decorative by role: the card's own lines name the place. */}
        {card.image && <CmsImage media={card.image} decorative fill sizes="(max-width: 759px) 76vw, 308px" className="dest-img" />}
      </span>
      <span className="dest-scrim" aria-hidden="true" />
      <span className="dest-copy">
        <span className="dest-title">
          {card.cardTitle[0]}
          <br />
          {card.cardTitle[1]}
        </span>
        <span className="dest-blurb">
          {card.cardBlurb[0]}
          <br />
          {card.cardBlurb[1]}
        </span>
        <span className="dest-count">{count}</span>
      </span>
    </>
  );

  return (
    <div ref={ref} data-reveal="clip" className="dest-card">
      {onPick ? (
        <button type="button" className="dest-hit" onClick={onPick}>
          {body}
          <span className="sr-only">{`${card.cardTitle.join(' ')} — ${count}`}</span>
        </button>
      ) : (
        <div className="dest-hit dest-hit-static">{body}</div>
      )}
    </div>
  );
}
