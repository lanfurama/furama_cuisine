'use client';

import Image from 'next/image';
import { STORIES } from '@/lib/data';
import { useReveal } from '@/lib/motion';

export function Stories() {
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
          {STORIES.map((s) => (
            <StoryCard key={s.slot} {...s} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StoryCard({
  img,
  kicker,
  title,
  href,
}: {
  img: string;
  kicker: string;
  title: string;
  href: string;
}) {
  const ref = useReveal<HTMLAnchorElement>('card');

  return (
    <a ref={ref} data-reveal="card" href={href} target="_blank" rel="noopener" className="story">
      <span className="story-frame frame" data-reveal-img="1">
        <span className="story-zoom" data-reveal-zoom="1">
          <Image
            src={`/assets/${img}.jpg`}
            alt=""
            fill
            sizes="(max-width: 759px) 72vw, 302px"
            className="story-img"
          />
        </span>
      </span>
      <span className="story-kicker">{kicker}</span>
      <span className="story-title">{title}</span>
    </a>
  );
}
