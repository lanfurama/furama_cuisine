'use client';

import { MenuLanguages } from '@/components/site/LanguageSwitcher';
import { useSite } from '@/components/site/SiteProvider';
import { useOpenAnimation } from '@/lib/motion';

export function MenuOverlay() {
  const { site, overlay, close, open, scrollToId, openReserve, strings } = useSite();
  const isOpen = overlay === 'menu';

  useOpenAnimation(isOpen, (animate) => {
    animate('[data-anim="menu"]', [{ opacity: 0 }, { opacity: 1 }], 400, 0, 'ease');
    animate(
      '[data-anim="menu-item"]',
      [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      700,
      120,
      undefined,
      40,
    );
  });

  if (!isOpen) return null;

  return (
    <div data-anim="menu" className="menu-root" role="dialog" aria-modal="true" aria-label={strings['ui.menu_aria']}>
      <div className="menu-head">
        <div className="menu-wordmark">FURAMA CUISINE</div>
        <button type="button" className="overlay-close" aria-label={strings['ui.close_menu']} onClick={close}>
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
