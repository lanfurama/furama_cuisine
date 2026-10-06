import { describe, expect, it } from 'vitest';
import { previewPath } from './preview';

const CODES = ['en', 'vi', 'ko'];

describe('previewPath: never an open redirect (C6)', () => {
  it.each([
    ['/ko', '/ko'],
    ['/ko/restaurants/taya-house', '/ko/restaurants/taya-house'],
    ['/vi/privacy?x=1', '/vi/privacy?x=1'],
  ])('accepts %s', (raw, path) => expect(previewPath(raw, CODES)).toBe(path));

  it.each([
    ['', 'empty'],
    ['ko', 'not rooted'],
    ['//evil.example/ko', 'protocol-relative'],
    ['/\\evil.example', 'a backslash'],
    ['https://evil.example/ko', 'another origin'],
    ['/zz', 'a language not in the table'],
    ['/admin', 'not a guest page'],
    [`/ko/${'a'.repeat(300)}`, 'too long'],
  ])('refuses %j (%s)', (raw) => expect(previewPath(raw, CODES)).toBeNull());

  it('refuses a missing path', () => expect(previewPath(null, CODES)).toBeNull());
});
