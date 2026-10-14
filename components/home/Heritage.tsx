'use client';

import type { Copy } from '@/lib/i18n/registry';
import { useSite } from '@/components/site/SiteProvider';
import { CmsImage } from '@/components/ui/CmsImage';
import { SplitWords } from '@/components/ui/SplitWords';
import { FriezeDivider } from '@/components/ui/Ornament';
import { useReveal } from '@/lib/motion';

/**
 * The picture and the OUR STORY link are the section's own (sections.image_id, link_url); no link, no button.
 * The copy (heritage.*) comes from the page; the title's two lines are two keys (the box has a fixed height).
 */
export function Heritage({ copy }: { copy: Copy<'heritage'> }) {
  const { site } = useSite();
  const { image, link } = site.sections.heritage;
  const ornament = useReveal<HTMLSpanElement>('fade');
  const kicker = useReveal<HTMLDivElement>('fade');
  const title = useReveal<HTMLHeadingElement>('title');
  const cta = useReveal<HTMLAnchorElement>('up');
  const year = copy['heritage.kicker'].match(/\b(1[89]\d\d|20\d\d)\b/)?.[1] ?? null;

  return (
    <section id="heritage" className="heritage">
      {/* A background: alt="" whatever the file says. No `fill`: the parallax CSS sizes and moves it. */}
      {image && (
        <CmsImage
          media={image}
          decorative
          width={image.width}
          height={image.height}
          sizes="100vw"
          className="heritage-img"
          data-parallax="0.2"
          data-parallax-max="0.11"
          data-scale-in="1.22"
        />
      )}
      <div className="heritage-scrim" aria-hidden="true" />
      {/* The kicker's year ("Since 1997"), very large and in outline behind the words; none without a year. */}
      {year && (
        <span className="heritage-year" aria-hidden="true">
          {year}
        </span>
      )}

      <div className="heritage-body">
        <FriezeDivider ref={ornament} reveal="fade" className="heritage-orn" />
        <div ref={kicker} data-reveal="fade" className="heritage-kicker">
          {copy['heritage.kicker']}
        </div>
        <h2 ref={title} data-reveal="title" className="heritage-title">
          <SplitWords text={copy['heritage.title_1']} />
          <br />
          <SplitWords text={copy['heritage.title_2']} />
        </h2>
        {link && (
          <a ref={cta} data-reveal="up" href={link} target="_blank" rel="noopener" className="btn-slab heritage-cta" data-magnetic="">
            {copy['heritage.cta']}
            <span className="arrow">→</span>
          </a>
        )}
      </div>
    </section>
  );
}
