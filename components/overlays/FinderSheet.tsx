'use client';

import { useSite } from '@/components/site/SiteProvider';
import { ChipGroup } from '@/components/ui/Dropdown';
import { useRef } from 'react';
import { EASE_DRAWER, EASE_OUT, useOverlayPresence } from '@/lib/motion';
import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';

/** The phone equivalent of the desktop finder. */
export function FinderSheet() {
  const { site, overlay, close, finder, setFinder, applyFinder, strings } = useSite();
  const open = overlay === 'sheet';

  const root = useRef<HTMLDivElement>(null);
  /* Up from the foot and back down it, on the Reserve drawer's curve and times (components/overlays/DrawerMotion.tsx). */
  const present = useOverlayPresence(open, root, (box) => [
    {
      el: box.querySelector('.sheet'),
      away: { transform: 'translateY(100%)' },
      in: { duration: 450, easing: EASE_DRAWER },
      out: { duration: 280, easing: EASE_DRAWER },
    },
    {
      el: box.querySelector('.backdrop'),
      away: { opacity: 0 },
      in: { duration: 300, easing: EASE_OUT },
      out: { duration: 280, easing: EASE_OUT },
    },
  ]);
  const leaving = present && !open;

  if (!present) return null;

  return (
    <div
      ref={root}
      className="sheet-root"
      role={leaving ? undefined : 'dialog'}
      aria-modal={leaving ? undefined : 'true'}
      aria-label={leaving ? undefined : strings['finder.title']}
      inert={leaving}
    >
      <button
        type="button"
        className="backdrop"
        aria-label={strings['common.close']}
        onClick={close}
      />

      <div className="sheet">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title">{strings['finder.title']}</div>
          {/* Where the focus goes when the sheet opens (data-autofocus, components/site/Chrome.tsx). */}
          <button type="button" className="overlay-close" aria-label={strings['common.close']} onClick={close} data-autofocus>
            ×
          </button>
        </div>

        {/* The choices: what scrolls when the screen is short, between the title and the button. */}
        <div className="sheet-body">
          <ChipGroup
            label={strings['finder.cuisine']}
            value={finder.cuisine}
            options={cuisineOptions(site.cuisines, strings)}
            onPick={(cuisine) => setFinder({ cuisine })}
          />
          <ChipGroup
            label={strings['finder.occasion']}
            value={finder.occasion}
            options={occasionOptions(strings)}
            onPick={(occasion) => setFinder({ occasion })}
          />
          <ChipGroup
            label={strings['finder.destination']}
            value={finder.destination}
            options={destinationOptions(site.destinations, strings)}
            onPick={(destination) => setFinder({ destination })}
          />
        </div>

        <button type="button" className="sheet-submit" onClick={applyFinder}>
          {strings['finder.submit']}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
