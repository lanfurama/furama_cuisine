'use client';

import type { Media, Story } from '@/lib/content/types';
import { CmsImage } from '@/components/ui/CmsImage';
import { useReveal } from '@/lib/motion';

/** The cards (stories) come from the page, their kicker already formatted on the server. */
export function Stories({ items }: { items: Story[] }) {
  const title = useReveal<HTMLHeadingElement>('title');
  const lede = useReveal<HTMLParagraphElement>('up');

  return (
    <section id="stories" className="stories">
      <div className="shell">
        <div className="stories-head">
          <h2 ref={title} data-reveal="title" className="section-title balance">
            Stories from our Kitchens
          </h2>
          <p ref={lede} data-reveal="up" className="section-lede">
            Chefs, ingredients and the cultures behind every plate.
          </p>
        </div>

        <div className="stories-rail">
          {items.map((s) => (
            <StoryCard key={s.id} image={s.image} kicker={s.kicker} title={s.title} href={s.href} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StoryCard({
  image,
  kicker,
  title,
  href,
}: {
  image: Media | null;
  kicker: string;
  title: string;
  href: string;
}) {
  const ref = useReveal<HTMLAnchorElement>('card');

  return (
    <a ref={ref} data-reveal="card" href={href} target="_blank" rel="noopener" className="story">
      <span className="story-frame frame" data-reveal-img="1">
        <span className="story-zoom" data-reveal-zoom="1">
          {/* Decorative by role: the title below says what the story is. */}
          {image && <CmsImage media={image} decorative fill sizes="(max-width: 759px) 72vw, 302px" className="story-img" />}
        </span>
      </span>
      <span className="story-kicker">{kicker}</span>
      <span className="story-title">{title}</span>
    </a>
  );
}
