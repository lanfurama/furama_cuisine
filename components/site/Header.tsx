'use client';

import { NAV_LINKS } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

const LANGS: { value: 'EN' | 'VI'; label: string }[] = [
  { value: 'EN', label: 'English' },
  { value: 'VI', label: 'Tiếng Việt' },
];

export function Header() {
  const {
    view,
    scrolled,
    open,
    openReserve,
    scrollToId,
    goHomeTop,
    lang,
    setLang,
    openDropdown,
    toggleDropdown,
    closeDropdown,
  } = useSite();

  const langOpen = openDropdown === 'lang';

  // On a phone the detail view carries its own in-hero back button instead.
  const hideOnMobile = view === 'detail';

  return (
    <>
      <header
        className="hdr hdr-full"
        data-header="1"
        data-solid={scrolled}
        data-hide-mobile={hideOnMobile}
      >
        <div className="hdr-inner">
          <a
            href="/"
            className="hdr-logo"
            onClick={(e) => {
              e.preventDefault();
              goHomeTop();
            }}
          >
            <span className="hdr-logo-word">FURAMA</span>
            <span className="hdr-logo-sub">CUISINE</span>
          </a>

          <nav className="hdr-nav" aria-label="Main">
            {NAV_LINKS.map((l) => (
              <button type="button" key={l.target} className="hdr-link" onClick={() => scrollToId(l.target)}>
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hdr-actions">
            <button type="button" className="hdr-link" onClick={() => open('search')}>
              SEARCH
            </button>

            <div className="hdr-lang" data-dd="1">
              <button
                type="button"
                className="hdr-link hdr-lang-btn"
                aria-expanded={langOpen}
                onClick={() => toggleDropdown('lang')}
              >
                {lang}
                <span className="hdr-lang-caret">▾</span>
              </button>
              {langOpen && (
                <div className="hdr-lang-panel" role="listbox" aria-label="Language">
                  {LANGS.map((l) => (
                    <button
                      type="button"
                      key={l.value}
                      role="option"
                      aria-selected={lang === l.value}
                      className="hdr-lang-option"
                      data-selected={lang === l.value}
                      onClick={() => {
                        setLang(l.value);
                        closeDropdown();
                      }}
                    >
                      <span>{l.label}</span>
                      <span className="hdr-lang-mark">{lang === l.value ? '●' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button type="button" className="btn-gold" onClick={() => openReserve()}>
              RESERVE
            </button>
          </div>
        </div>
      </header>

      <header
        className="hdr hdr-compact"
        data-header="1"
        data-solid={scrolled}
        data-hide-mobile={hideOnMobile}
      >
        <div className="hdr-inner">
          <a
            href="/"
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
              RESERVE
            </button>
            <button type="button" className="hdr-burger" aria-label="Open menu" onClick={() => open('menu')}>
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
