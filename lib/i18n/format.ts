/**
 * Fills {name} placeholders. Phase 2 needs nothing more (the only variable is
 * {restaurant}), so there is no ICU parser yet. Plurals and selects arrive with
 * the first string that needs them; swap this body for intl-messageformat then
 * and no caller changes, because the signature already carries the locale.
 */
export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams = {}, _locale = 'en'): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** True when the text uses ICU syntax beyond {name} (plural, select, nested braces). */
export function usesIcuSyntax(template: string): boolean {
  return /\{\s*\w+\s*,/.test(template) || /\{[^{}]*\{/.test(template);
}
