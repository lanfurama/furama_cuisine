'use client';

import { useSite } from '@/components/site/SiteProvider';
import { homeHref } from '@/lib/i18n/href';

const LANGS: { value: 'EN' | 'VI'; label: string }[] = [
  { value: 'EN', label: 'English' },
  { value: 'VI', label: 'Tiếng Việt' },
];

export function Header() {
  const {
    locale,
    site,
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
    strings,
  } = useSite();

  const langOpen = openDropdown === 'lang';

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
                <div className="hdr-lang-panel" role="listbox" aria-label={strings['ui.language_aria']}>
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
