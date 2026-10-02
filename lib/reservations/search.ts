import { toE164 } from '@/lib/phone';

/*
 * What staff typed in the inbox search box (spec §7.2: mã, SĐT, tên, email).
 * A reference or a phone is an exact lookup on its own index; anything else
 * is a substring of reservations.search_text (trigram index), folded by the
 * same SQL function that built the column (fold_search).
 */
export type SearchQuery = { kind: 'reference'; value: string } | { kind: 'phone'; value: string } | { kind: 'text'; value: string };

const CROCKFORD_8 = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const LEGACY_5 = /^\d{5}$/;
const PHONE_CHARS = /^[+\d\s().-]+$/;

/**
 * FC-XXXXXXXX (Crockford base32) or a phase-1 FC-12345, whatever the case,
 * with or without the dash; O reads as 0 and I/L as 1, as spoken over the
 * phone. Only when it starts with "FC": five bare digits are more likely part
 * of a phone number.
 */
export function normalizeReference(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!compact.startsWith('FC')) return null;
  const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  return LEGACY_5.test(body) || CROCKFORD_8.test(body) ? `FC-${body}` : null;
}

export function parseSearch(raw: string | null | undefined): SearchQuery | null {
  const q = (raw ?? '').trim().slice(0, 100);
  if (q.length < 2) return null;
  const reference = normalizeReference(q);
  if (reference) return { kind: 'reference', value: reference };
  if (PHONE_CHARS.test(q) && q.replace(/\D/g, '').length >= 8) {
    const phone = toE164(q);
    if (phone) return { kind: 'phone', value: phone };
  }
  // Digits only: search_text holds the phone's digits, so "3456" finds a number ending in 3456.
  return { kind: 'text', value: PHONE_CHARS.test(q) ? q.replace(/\D/g, '') : q };
}

/** Escapes LIKE's wildcards, so "50%" matches those characters, not everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
