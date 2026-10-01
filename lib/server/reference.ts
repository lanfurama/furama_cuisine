import 'server-only';
import { randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a reference survives being read over the phone. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const REFERENCE_PATTERN = /^FC-[0-9A-HJKMNP-TV-Z]{8}$/;

/** FC- plus 8 random characters: about 10^12 values, and not guessable in sequence. */
export function newReference(): string {
  let reference = 'FC-';
  for (let i = 0; i < 8; i++) reference += ALPHABET[randomInt(ALPHABET.length)];
  return reference;
}
