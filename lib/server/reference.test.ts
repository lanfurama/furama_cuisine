import { describe, expect, it } from 'vitest';
import { REFERENCE_PATTERN, newReference } from './reference';

describe('newReference', () => {
  it('is FC- plus eight Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(REFERENCE_PATTERN);
  });

  it('never uses letters that read like digits over the phone', () => {
    const sample = Array.from({ length: 500 }, () => newReference().slice(3)).join('');
    expect(sample).not.toMatch(/[ILOU]/);
  });
});
