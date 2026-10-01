'use client';

import Image from 'next/image';
import { CUISINES, cuisineImage } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

export function Cuisines() {
  const { filter, pickCuisine, setFilter, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  return (
    <section id="cuisines" className="cuisines">
      <div className="shell">
        <div className="section-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            Explore by Cuisine
          </h2>
          <button
            ref={link}
            data-reveal="fade"
            type="button"
            className="text-link"
            onClick={() => {
              setFilter({ cuisine: 'all' });
              scrollToId('restaurants');
            }}
          >
            ALL CUISINES →
          </button>
        </div>

        <div className="cuisine-rail">
          {CUISINES.map(([label, slug]) => (
            <CuisineChip
              key={slug}
              label={label}
              slug={slug}
              selected={filter.cuisine === slug}
              onPick={() => pickCuisine(slug)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CuisineChip({
  label,
  slug,
  selected,
  onPick,
}: {
  label: string;
  slug: string;
  selected: boolean;
  onPick: () => void;
}) {
  const ref = useReveal<HTMLButtonElement>('up');

  return (
    <button
      ref={ref}
      data-reveal="up"
      type="button"
      className="cuisine"
      aria-pressed={selected}
      onClick={onPick}
    >
      <span className="cuisine-ring" data-selected={selected}>
        <Image src={cuisineImage(slug)} alt="" width={80} height={80} className="cuisine-img" />
      </span>
      <span className="cuisine-label" data-selected={selected}>
        {label}
      </span>
    </button>
  );
}
