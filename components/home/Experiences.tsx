'use client';

import type { Experience } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';
import { CmsImage } from '@/components/ui/CmsImage';
import { useReveal } from '@/lib/motion';

/** The rows (experiences) come from the page; the picture is the section's own (sections.image_id), optimised by next/image (CmsImage). */
export function Experiences({ items }: { items: Experience[] }) {
  const { site } = useSite();
  const image = site.sections.experiences.image;
  const media = useReveal<HTMLDivElement>('wipe');
  const kicker = useReveal<HTMLDivElement>('fade');
  const title = useReveal<HTMLHeadingElement>('title');

  return (
    <section id="experiences" className="experiences">
      <div ref={media} data-reveal="wipe" className="experiences-media">
        {image && <CmsImage media={image} width={image.width} height={image.height} sizes="(max-width: 759px) 100vw, 50vw" className="fill" />}
      </div>

      <div className="experiences-body">
        <div ref={kicker} data-reveal="fade" className="eyebrow">
          Experiences
        </div>
        <h2 ref={title} data-reveal="title" className="experiences-title">
          More than a meal.
          <br />
          A meaningful experience.
        </h2>

        <div className="experiences-list">
          {items.map((e) => (
            <ExperienceRow key={e.id} title={e.title} blurb={e.blurb} href={e.href} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** A row without its own link points at its section, as before phase 6 (spec §15 item 16: the owner supplies the links). */
function ExperienceRow({ title, blurb, href }: { title: string; blurb: string; href: string | null }) {
  const ref = useReveal<HTMLAnchorElement>('right');

  return (
    <a
      ref={ref}
      data-reveal="right"
      href={href ?? '#experiences'}
      {...(href ? { target: '_blank', rel: 'noopener' } : {})}
      className="experience-row"
    >
      <span className="experience-copy">
        <span className="experience-name">{title}</span>
        <span className="experience-blurb">{blurb}</span>
      </span>
      <span className="experience-arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}
