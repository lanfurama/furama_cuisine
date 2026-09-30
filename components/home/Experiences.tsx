'use client';

import { EXPERIENCES } from '@/lib/data';
import { useReveal } from '@/lib/motion';

export function Experiences() {
  const media = useReveal<HTMLDivElement>('wipe');
  const kicker = useReveal<HTMLDivElement>('fade');
  const title = useReveal<HTMLHeadingElement>('title');

  return (
    <section id="experiences" className="experiences">
      <div ref={media} data-reveal="wipe" className="experiences-media">
        <img src="/assets/chef.jpg" alt="A Furama chef at work" className="fill" loading="lazy" />
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
          {EXPERIENCES.map((e) => (
            <ExperienceRow key={e.title} title={e.title} blurb={e.blurb} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ExperienceRow({ title, blurb }: { title: string; blurb: string }) {
  const ref = useReveal<HTMLAnchorElement>('right');

  return (
    <a ref={ref} data-reveal="right" href="#experiences" className="experience-row">
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
