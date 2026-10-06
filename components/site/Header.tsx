'use client';

import { HeaderLanguages } from '@/components/site/LanguageSwitcher';
import { useSite } from '@/components/site/SiteProvider';
import { homeHref } from '@/lib/i18n/href';

export function Header() {
  const {
    locale,
    site,
    scrolled,
    open,
    openReserve,
    scrollToId,
    goHomeTop,
    strings,
  } = useSite();

  return (
    <>
      <header
        className="hdr hdr-full"
        data-header="1"
        data-solid={scrolled}
      >
        <div className="hdr-inner">
          <a
            href={homeHref(locale)}
            className="hdr-logo"
            onClick={(e) => {
              e.preventDefault();
              goHomeTop();
            }}
          >
            <span className="hdr-logo-word">FURAMA</span>
            <span className="hdr-logo-sub">CUISINE</span>
          </a>

          {/* nav_item_i18n holds one label per language as written ("Restaurants"); styles/layout.css sets it in capitals here. */}
          <nav className="hdr-nav" aria-label={strings['ui.nav_aria']}>
            {site.nav.map((l) => (
              <button type="button" key={l.target} className="hdr-link" onClick={() => scrollToId(l.target)}>
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hdr-actions">
            <button type="button" className="hdr-link" onClick={() => open('search')}>
              {strings['ui.search']}
            </button>

            <HeaderLanguages />

            <button type="button" className="btn-gold" onClick={() => openReserve()}>
              {strings['ui.reserve']}
            </button>
          </div>
        </div>
      </header>

      <header
        className="hdr hdr-compact"
        data-header="1"
        data-solid={scrolled}
      >
        <div className="hdr-inner">
          <a
            href={homeHref(locale)}
            className="hdr-wordmark"
            onClick={(e) => {
              e.preventDefault();
              goHomeTop();
            }}
          >
            FURAMA CUISINE
          </a>
          <div className="hdr-compact-actions">
            <button type="button" className="btn-gold hdr-compact-reserve" onClick={() => openReserve()}>
              {strings['ui.reserve']}
            </button>
            <button type="button" className="hdr-burger" aria-label={strings['ui.open_menu']} onClick={() => open('menu')}>
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
