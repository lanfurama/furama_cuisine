'use client';

import { useSite } from '@/components/site/SiteProvider';
import { LOCALE_COOKIE } from '@/lib/i18n/locales';

/** An enabled language as the switcher shows it: its own code and name, from the locales table (R35). */
export type SwitcherLanguage = { code: string; bcp47: string; shortLabel: string; nativeName: string };

/**
 * The same page in `code` (R8-10): the first path segment is the language, the
 * rest and the query stay. The hash is left off: a section id may not exist on
 * the other side yet.
 */
export function switchHref(pathname: string, search: string, code: string): string {
  const path = pathname.split('/').slice(2).join('/');
  return `/${code}${path ? `/${path}` : ''}${search}`;
}

/** The choice the proxy honours on the next visit to / (spec §3: cookie first), set before the browser leaves. */
export function rememberLocale(code: string): void {
  document.cookie = `${LOCALE_COOKIE}=${code}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** A plain link that reloads the page in that language (spec §6.1: the booking form's state is not kept). */
function LanguageLink({ language, className, children }: { language: SwitcherLanguage; className: string; children: React.ReactNode }) {
  const { locale } = useSite();
  const current = language.code === locale;
  return (
    <a
      href={`/${language.code}`}
      hrefLang={language.bcp47}
      lang={language.bcp47}
      className={className}
      data-selected={current}
      aria-current={current ? 'true' : undefined}
      onClick={(e) => {
        // The href above is what a crawler and a no-JS visitor follow; with JS, the same page in that language.
        e.preventDefault();
        rememberLocale(language.code);
        window.location.assign(switchHref(window.location.pathname, window.location.search, language.code));
      }}
    >
      {children}
    </a>
  );
}

/** The header's dropdown. Nothing when only one language is on (spec §3). */
export function HeaderLanguages() {
  const { languages, locale, openDropdown, toggleDropdown, strings } = useSite();
  if (languages.length < 2) return null;
  const open = openDropdown === 'lang';
  const current = languages.find((l) => l.code === locale);
  return (
    <div className="hdr-lang" data-dd="1">
      <button type="button" className="hdr-link hdr-lang-btn" aria-expanded={open} onClick={() => toggleDropdown('lang')}>
        {current?.shortLabel ?? locale.toUpperCase()}
        <span className="hdr-lang-caret">▾</span>
      </button>
      {open && (
        <div className="hdr-lang-panel" role="group" aria-label={strings['ui.language_aria']}>
          {languages.map((l) => (
            <LanguageLink key={l.code} language={l} className="hdr-lang-option">
              <span>{l.nativeName}</span>
              <span className="hdr-lang-mark">{l.code === locale ? '●' : ''}</span>
            </LanguageLink>
          ))}
        </div>
      )}
    </div>
  );
}

/** The phone menu's row of codes. Nothing when only one language is on. */
export function MenuLanguages() {
  const { languages } = useSite();
  if (languages.length < 2) return null;
  return (
    <div className="menu-langs">
      {languages.map((l) => (
        <LanguageLink key={l.code} language={l} className="menu-lang">
          {l.shortLabel}
        </LanguageLink>
      ))}
    </div>
  );
}
