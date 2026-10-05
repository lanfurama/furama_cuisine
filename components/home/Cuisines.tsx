'use client';

import type { Media } from '@/lib/content/types';
import type { Copy } from '@/lib/i18n/registry';
import { CmsImage } from '@/components/ui/CmsImage';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/** The chips come from the layout's cuisines; the section's copy (cuisines.*) from the page, read on the server. */
export function Cuisines({ copy }: { copy: Copy<'cuisines'> }) {
  const { site, filter, pickCuisine, setFilter, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  return (
    <section id="cuisines" className="cuisines">
      <div className="shell">
        <div className="section-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            {copy['cuisines.title']}
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
            {`${copy['cuisines.all']} →`}
          </button>
        </div>

        <div className="cuisine-rail">
          {site.cuisines.map((c) => (
            <CuisineChip
              key={c.id}
              label={c.label}
              image={c.image}
              selected={filter.cuisine === c.id}
              onPick={() => pickCuisine(c.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CuisineChip({
  label,
  image,
  selected,
  onPick,
}: {
  label: string;
  image: Media | null;
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
        {/* Decorative by role: the label beside it names the cuisine. */}
        {image && <CmsImage media={image} decorative width={80} height={80} className="cuisine-img" />}
      </span>
      <span className="cuisine-label" data-selected={selected}>
        {label}
      </span>
    </button>
  );
}
