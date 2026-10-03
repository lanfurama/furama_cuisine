'use client';

import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/** The picture and the OUR STORY link are the section's own (sections.image_id, link_url); no link, no button. */
export function Heritage() {
  const { site } = useSite();
  const { image, link } = site.sections.heritage;
  const kicker = useReveal<HTMLDivElement>('fade');
  const title = useReveal<HTMLHeadingElement>('title');
  const cta = useReveal<HTMLAnchorElement>('up');

  return (
    <section id="heritage" className="heritage">
      {/* A background: alt="" whatever the file says, a plain <img> (R3). */}
      {image && (
        <img src={image.url} alt="" className="heritage-img" data-parallax="0.2" data-parallax-max="0.11" loading="lazy" />
      )}
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
        {link && (
          <a ref={cta} data-reveal="up" href={link} target="_blank" rel="noopener" className="btn-slab heritage-cta">
            OUR STORY<span className="arrow">→</span>
          </a>
        )}
      </div>
    </section>
  );
}
