import { IntlMessageFormat } from 'intl-messageformat';
import { toBcp47 } from './locales';

/*
 * Fills a registry string. A plain template ({name} placeholders only) keeps
 * phase 2's replace: an unknown placeholder stays visible, and an ASCII
 * apostrophe stays a character (ICU would treat '{…}' as quoting). A template
 * with ICU syntax (plural, select) goes through intl-messageformat (spec §4:
 * intl-messageformat ^12), with the page's language for the plural rules.
 */
export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams = {}, locale = 'en'): string {
  if (usesIcuSyntax(template)) {
    try {
      return String(new IntlMessageFormat(template, toBcp47(locale), undefined, { ignoreTag: true }).format(params));
    } catch {
      // A value that passed the editor's checks never lands here; a guest still gets words, not an error page.
      return template;
    }
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** True when the text uses ICU syntax beyond {name} (plural, select, nested braces). */
export function usesIcuSyntax(template: string): boolean {
  return /\{\s*\w+\s*,/.test(template) || /\{[^{}]*\{/.test(template);
}
