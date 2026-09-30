'use client';

import Image from 'next/image';
import { TAYA_EXPERIENCES } from '@/lib/data';
import { useReveal } from '@/lib/motion';

export function TayaExperiences() {
  const title = useReveal<HTMLHeadingElement>('title');

  return (
    <section id="dishes" className="dishes">
      <div className="shell">
        <h2 ref={title} data-reveal="title" className="section-title">
          At Tàya House
        </h2>

        <div className="dishes-rail">
          {TAYA_EXPERIENCES.map((e) => (
            <DishCard key={e.slot} {...e} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DishCard({
  img,
  alt,
  title,
  detail,
}: {
  img: string;
  alt: string;
  title: string;
  detail: string;
}) {
  const ref = useReveal<HTMLDivElement>('card');

  return (
    <div ref={ref} data-reveal="card" className="dish">
      <div className="dish-frame frame" data-reveal-img="1">
        <span className="dish-zoom" data-reveal-zoom="1">
          <Image
            src={`/assets/${img}.jpg`}
            alt={alt}
            fill
            sizes="(max-width: 759px) 66vw, 240px"
            className="dish-img"
          />
        </span>
      </div>
      <div className="dish-title">{title}</div>
      <div className="dish-detail">{detail}</div>
    </div>
  );
}
