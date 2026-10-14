'use client';

import { Fragment } from 'react';
import { useSite } from '@/components/site/SiteProvider';
import { RosetteMark } from '@/components/ui/Ornament';

/**
 * A band of the cuisines' names in large italic, running sideways forever and
 * leaning with the speed of the scroll (lib/motion.tsx, [data-velocity]).
 * Decorative: the cuisines section names them for real, so the band is
 * aria-hidden. The names come from the layout's cuisines (staff edit them),
 * written twice so the loop never shows a seam.
 */
export function Marquee() {
  const { site } = useSite();
  const names = site.cuisines.map((c) => c.label);
  if (names.length === 0) return null;

  const run = (copy: number) =>
    names.map((name, i) => (
      <Fragment key={`${copy}-${i}`}>
        <span className="marquee-word">{name}</span>
        <RosetteMark className="marquee-mark" />
      </Fragment>
    ));

  return (
    <div className="marquee" aria-hidden="true" data-velocity="">
      <div className="marquee-track">
        <div className="marquee-run">{run(0)}</div>
        <div className="marquee-run">{run(1)}</div>
      </div>
    </div>
  );
}
