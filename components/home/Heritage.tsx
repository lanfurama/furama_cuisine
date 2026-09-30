'use client';

import { CONTACT } from '@/lib/data';
import { useReveal } from '@/lib/motion';

export function Heritage() {
  const kicker = useReveal<HTMLDivElement>('fade');
  const title = useReveal<HTMLHeadingElement>('title');
  const cta = useReveal<HTMLAnchorElement>('up');

  return (
    <section id="heritage" className="heritage">
      <img
        src="/assets/heritage.jpg"
        alt=""
        className="heritage-img"
        data-parallax="0.2"
        data-parallax-max="0.11"
        loading="lazy"
      />
      <div className="heritage-scrim" aria-hidden="true" />

      <div className="heritage-body">
        <div ref={kicker} data-reveal="fade" className="heritage-kicker">
          Since 1997 · Furama Resort Danang
        </div>
        <h2 ref={title} data-reveal="title" className="heritage-title">
          A culinary heritage
          <br />
          that keeps evolving
        </h2>
        <a
          ref={cta}
          data-reveal="up"
          href={CONTACT.story}
          target="_blank"
          rel="noopener"
          className="btn-slab heritage-cta"
        >
          OUR STORY<span className="arrow">→</span>
        </a>
      </div>
    </section>
  );
}
