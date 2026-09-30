'use client';

import Image from 'next/image';
import { DESTINATION_CARDS, type DestKey, type DestinationCard } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

export function Destinations() {
  const { restaurants, pickDestination } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const lede = useReveal<HTMLParagraphElement>('up');
  const journey = useReveal<HTMLDivElement>('journey');

  return (
    <section id="destinations" className="destinations">
      <div className="shell">
        <div className="destinations-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            Our Destinations
          </h2>
          <p ref={lede} data-reveal="up" className="section-lede">
            Different places. One culinary family.
          </p>
        </div>

        {/* The dotted route line that ties the destinations together. */}
        <div ref={journey} data-reveal="journey" className="journey" aria-hidden="true">
          <div data-jline="1" className="journey-line" />
          {[12.5, 37.5, 62.5, 87.5].map((left) => (
            <span key={left} data-jdot="1" className="journey-dot" style={{ left: `${left}%` }} />
          ))}
        </div>

        <div className="dest-rail">
          {DESTINATION_CARDS.map((card) => (
            <DestCard
              key={card.key}
              card={card}
              count={
                card.key === 'future'
                  ? 'Coming soon'
                  : `${restaurants.filter((r) => r.dest === card.key).length} restaurants →`
              }
              onPick={card.key === 'future' ? undefined : () => pickDestination(card.key as DestKey)}
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
  card: DestinationCard;
  count: string;
  onPick?: () => void;
}) {
  const ref = useReveal<HTMLDivElement>('clip');

  const body = (
    <>
      <span className="dest-zoom" data-reveal-zoom="1">
        <Image
          src={`/assets/${card.slot}.jpg`}
          alt=""
          fill
          sizes="(max-width: 759px) 76vw, 308px"
          className="dest-img"
        />
      </span>
      <span className="dest-scrim" aria-hidden="true" />
      <span className="dest-copy">
        <span className="dest-title">
          {card.title[0]}
          <br />
          {card.title[1]}
        </span>
        <span className="dest-blurb">
          {card.blurb[0]}
          <br />
          {card.blurb[1]}
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
          <span className="sr-only">{`${card.title.join(' ')} — ${count}`}</span>
        </button>
      ) : (
        <div className="dest-hit dest-hit-static">{body}</div>
      )}
    </div>
  );
}
