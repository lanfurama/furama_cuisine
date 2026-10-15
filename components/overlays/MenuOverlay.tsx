'use client';

import { MenuLanguages } from '@/components/site/LanguageSwitcher';
import { useSite } from '@/components/site/SiteProvider';
import { useRef } from 'react';
import { EASE_OUT, useOverlayPresence } from '@/lib/motion';

export function MenuOverlay() {
  const { site, overlay, close, open, scrollToId, openReserve, strings } = useSite();
  const isOpen = overlay === 'menu';

  const root = useRef<HTMLDivElement>(null);
  /* In: the menu fades up, then its lines rise one after another. Out: it fades, quicker. */
  const present = useOverlayPresence(
    isOpen,
    root,
    (box) => [{ el: box, away: { opacity: 0 }, in: { duration: 400, easing: 'ease' }, out: { duration: 200, easing: EASE_OUT } }],
    (box) =>
      box.querySelectorAll('[data-anim="menu-item"]').forEach((el, i) => {
        el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
          duration: 700,
          delay: 120 + i * 40,
          easing: EASE_OUT,
          fill: 'backwards',
        });
      }),
  );
  const leaving = present && !isOpen;

  if (!present) return null;

  return (
    <div
      ref={root}
      className="menu-root"
      role={leaving ? undefined : 'dialog'}
      aria-modal={leaving ? undefined : 'true'}
      aria-label={leaving ? undefined : strings['ui.menu_aria']}
      inert={leaving}
    >
      <div className="menu-head">
        <div className="menu-wordmark">FURAMA CUISINE</div>
        {/* Where the focus goes when the menu opens (data-autofocus, components/site/Chrome.tsx). */}
        <button type="button" className="overlay-close" aria-label={strings['ui.close_menu']} onClick={close} data-autofocus>
          ×
        </button>
      </div>

      <nav className="menu-nav" aria-label={strings['ui.sections_aria']}>
        {/* The header's links, as written (the header uppercases them; this list does not). */}
        {site.nav.map((l) => (
          <button
            key={l.target}
            type="button"
            data-anim="menu-item"
            className="menu-item"
            onClick={() => scrollToId(l.target)}
          >
            {l.label}
            <span className="menu-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ))}
        <button type="button" data-anim="menu-item" className="menu-item" onClick={() => open('search')}>
          {strings['ui.search_link']}
          <span className="menu-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </nav>

      <div className="menu-foot">
        <button type="button" className="menu-reserve" onClick={() => openReserve()}>
          {strings['ui.reserve_table']}
        </button>
        <div className="menu-foot-row">
          <MenuLanguages />
          <div className="menu-tagline">{strings['footer.tagline']}</div>
        </div>
      </div>
    </div>
  );
}
