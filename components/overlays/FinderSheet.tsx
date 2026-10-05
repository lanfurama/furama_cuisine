'use client';

import { useSite } from '@/components/site/SiteProvider';
import { ChipGroup } from '@/components/ui/Dropdown';
import { useOpenAnimation } from '@/lib/motion';
import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';

/** The phone equivalent of the desktop finder. */
export function FinderSheet() {
  const { site, overlay, close, finder, setFinder, applyFinder, strings } = useSite();
  const open = overlay === 'sheet';

  useOpenAnimation(open, (animate) => {
    animate('[data-anim="sheet"]', [{ transform: 'translateY(100%)' }, { transform: 'none' }], 700);
    animate('[data-anim="backdrop"]', [{ opacity: 0 }, { opacity: 1 }], 400);
  });

  if (!open) return null;

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label={strings['finder.title']}>
      <button
        type="button"
        data-anim="backdrop"
        className="backdrop"
        aria-label={strings['common.close']}
        onClick={close}
      />

      <div data-anim="sheet" className="sheet">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title">{strings['finder.title']}</div>
          <button type="button" className="overlay-close" aria-label={strings['common.close']} onClick={close}>
            ×
          </button>
        </div>

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

        <button type="button" className="sheet-submit" onClick={applyFinder}>
          {strings['finder.submit']}
          <span>→</span>
        </button>
      </div>
    </div>
  );
}
