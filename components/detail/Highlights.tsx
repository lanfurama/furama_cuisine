'use client';

import type { Highlight } from '@/lib/content/types';
import { CmsImage } from '@/components/ui/CmsImage';
import { useReveal } from '@/lib/motion';

/**
 * A restaurant page's highlights (restaurant_highlights; the page leaves the
 * section out when there are none). The id stays `dishes`, which MENU's
 * fallback scrolls to; the class names keep the first page's.
 */
export function Highlights({ title, items }: { title: string; items: Highlight[] }) {
  const heading = useReveal<HTMLHeadingElement>('title');

  return (
    <section id="dishes" className="dishes">
      <div className="shell">
        <h2 ref={heading} data-reveal="title" className="section-title">
          {title}
        </h2>

        <div className="dishes-rail">
          {items.map((h) => (
            <DishCard key={h.id} highlight={h} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DishCard({ highlight }: { highlight: Highlight }) {
  const ref = useReveal<HTMLDivElement>('card');

  return (
    <div ref={ref} data-reveal="card" className="dish">
      <div className="dish-frame frame" data-reveal-img="1">
        <span className="dish-zoom" data-reveal-zoom="1">
          <CmsImage media={highlight.image} fill sizes="(max-width: 759px) 66vw, 240px" className="dish-img" />
        </span>
      </div>
      <div className="dish-title">{highlight.title}</div>
      <div className="dish-detail">{highlight.detail}</div>
    </div>
  );
}
