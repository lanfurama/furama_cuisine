'use client';

import type { Copy } from '@/lib/i18n/registry';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/**
 * The picture and the OUR STORY link are the section's own (sections.image_id, link_url); no link, no button.
 * The copy (heritage.*) comes from the page; the title's two lines are two keys (the box has a fixed height).
 */
export function Heritage({ copy }: { copy: Copy<'heritage'> }) {
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
          {copy['heritage.kicker']}
        </div>
        <h2 ref={title} data-reveal="title" className="heritage-title">
          {copy['heritage.title_1']}
          <br />
          {copy['heritage.title_2']}
        </h2>
        {link && (
          <a ref={cta} data-reveal="up" href={link} target="_blank" rel="noopener" className="btn-slab heritage-cta">
            {copy['heritage.cta']}
            <span className="arrow">→</span>
          </a>
        )}
      </div>
    </section>
  );
}
