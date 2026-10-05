import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The admin stylesheet's shared tokens (7A review: the warn colours were
 * written into each rule; phase-4 ledger T13: two classes for one inline
 * form). Each warn colour is written once, as a --a-warn* token, and every
 * warn style reads it, so a later change of the palette is one line.
 */

const CSS = readFileSync(join(__dirname, '..', '..', 'styles', 'admin.css'), 'utf8');
const WARN_COLOURS = ['#7a5300', '#5c3f00', '#fff4d6', '#e3b04b'];

describe('the admin stylesheet', () => {
  it.each(WARN_COLOURS)('writes the warn colour %s once, as a token', (colour) => {
    expect(CSS.split(colour).length - 1).toBe(1);
    expect(CSS).toMatch(new RegExp(`--a-warn[a-z-]*: ${colour};`));
  });

  it('every warn style reads the tokens', () => {
    for (const rule of ['.a-warn {', '.a-warn-list {', '.a-counter--warn {', '.a-tag--warn {']) {
      const body = CSS.slice(CSS.indexOf(rule), CSS.indexOf('}', CSS.indexOf(rule)));
      expect(body, rule).toMatch(/var\(--a-warn/);
    }
  });

  it('has one class for an inline form (.a-inline-form), not two', () => {
    expect(CSS).not.toMatch(/\.a-inline\s*\{/);
  });
});
