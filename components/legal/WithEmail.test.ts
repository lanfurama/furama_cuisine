import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WithEmail } from './WithEmail';

const html = (template: string) => renderToStaticMarkup(createElement(WithEmail, { template, email: 'fb@furama.test' }));

describe('WithEmail (the policy page’s {email})', () => {
  it('links every {email}, not only the first (T8.4)', () => {
    expect(html('Write to {email}, or copy {email}.')).toBe(
      'Write to <a href="mailto:fb@furama.test">fb@furama.test</a>, or copy <a href="mailto:fb@furama.test">fb@furama.test</a>.',
    );
  });

  it('draws one link as phase 5 did, and plain text without {email}', () => {
    expect(html('Write to {email} or call us.')).toBe('Write to <a href="mailto:fb@furama.test">fb@furama.test</a> or call us.');
    expect(html('Call the restaurant.')).toBe('Call the restaurant.');
  });
});
