import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * A guest's phone in E.164 form ('+84905000000'). Numbers without a country
 * code are read as Vietnamese. Null when it is not a valid number.
 */
export function toE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'VN');
  return parsed?.isValid() ? parsed.number : null;
}
