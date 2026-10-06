import { createHash } from 'node:crypto';

/*
 * "EN đã đổi" (spec §5.1 item 3, §8 review queue): a translation row stores
 * source_hash, the fingerprint of its default-language row's columns when the
 * translation was written. It is out of date when that fingerprint no longer
 * matches the default row's current one. Columns in the order given; null and
 * '' are the same ("not set").
 */
export function sourceHash(columns: readonly string[], defaultRow: Record<string, unknown> | null | undefined): string {
  const values = columns.map((c) => {
    const v = defaultRow?.[c];
    return v === null || v === undefined || v === '' ? null : String(v);
  });
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export type TranslationState = 'missing' | 'machine' | 'reviewed' | 'stale';

/**
 * What a form tab and the coverage screen say of one translation row. The
 * default language is always 'reviewed'. A row written before phase 8 has no
 * source_hash: nothing says it is out of date, so it is not.
 */
export function translationState(
  row: Record<string, unknown> | null | undefined,
  currentSource: string,
  isDefault: boolean,
): TranslationState {
  if (isDefault) return 'reviewed';
  if (!row) return 'missing';
  if (typeof row.source_hash === 'string' && row.source_hash !== currentSource) return 'stale';
  return row.status === 'machine' ? 'machine' : 'reviewed';
}
