'use client';

import { useSite } from '@/components/site/SiteProvider';
import { ChipGroup } from '@/components/ui/Dropdown';
import { useOpenAnimation } from '@/lib/motion';
import { cuisineOptions, destinationOptions, occasionOptions } from '@/components/home/Finder';

/** The phone equivalent of the desktop finder. */
export function FinderSheet() {
  const { overlay, close, finder, setFinder, applyFinder } = useSite();
  const open = overlay === 'sheet';

  useOpenAnimation(open, (animate) => {
    animate('[data-anim="sheet"]', [{ transform: 'translateY(100%)' }, { transform: 'none' }], 700);
    animate('[data-anim="backdrop"]', [{ opacity: 0 }, { opacity: 1 }], 400);
  });

  if (!open) return null;

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label="Find a restaurant">
      <button
        type="button"
        data-anim="backdrop"
        className="backdrop"
        aria-label="Close"
        onClick={close}
      />

      <div data-anim="sheet" className="sheet">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title">Find a restaurant</div>
          <button type="button" className="overlay-close" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>

        <ChipGroup
          label="Cuisine"
          value={finder.cuisine}
          options={cuisineOptions()}
          onPick={(cuisine) => setFinder({ cuisine })}
        />
        <ChipGroup
          label="Occasion"
          value={finder.occasion}
          options={occasionOptions()}
          onPick={(occasion) => setFinder({ occasion })}
        />
        <ChipGroup
          label="Destination"
          value={finder.destination}
          options={destinationOptions()}
          onPick={(destination) => setFinder({ destination })}
        />

        <button type="button" className="sheet-submit" onClick={applyFinder}>
          SHOW RESTAURANTS<span>→</span>
        </button>
      </div>
    </div>
  );
}
