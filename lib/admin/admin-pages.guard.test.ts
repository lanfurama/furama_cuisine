import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * The admin renders at request time (spec §11). app/admin/layout.tsx makes
 * that so with `instant = false` + `await connection()`, but Cache Components
 * still validates navigations *between* admin pages in next dev and reports
 * every session read as a blocking route (instant-navigation.md:568). Each
 * admin page therefore says `instant = false` itself, and no admin file may
 * use style="" (style={…}) markup: the admin CSP has no 'unsafe-inline'.
 */
const ADMIN = 'app/admin';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const all = files(ADMIN).filter((f) => /\.tsx?$/.test(f));

describe('admin pages', () => {
  it('every page.tsx exports instant = false', () => {
    const pages = all.filter((f) => f.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThan(0);
    const missing = pages.filter((f) => !/^export const instant = false;$/m.test(readFileSync(f, 'utf8')));
    expect(missing.map((f) => relative('.', f))).toEqual([]);
  });

  it('the root layout blocks on connection() before rendering <html>', () => {
    const src = readFileSync(join(ADMIN, 'layout.tsx'), 'utf8');
    expect(src).toMatch(/^export const instant = false;$/m);
    // Code, not the comments that mention both: a statement of its own, before the <html …> element.
    const call = /^\s*await connection\(\);$/m.exec(src);
    const html = /<html\s/.exec(src);
    expect(call, 'no `await connection();` statement').not.toBeNull();
    expect(html, 'no <html …> element').not.toBeNull();
    expect(call!.index).toBeLessThan(html!.index);
  });

  it('has its own error boundary above the shell and auth layouts, as client components (not pages: no instant export needed)', () => {
    // app/admin/error.tsx catches what (shell)/layout.tsx and the (auth) pages throw; without
    // it they reach app/global-error.tsx, the guest's English page with an inline style.
    const boundaries = all.filter((f) => /(^|\/)error\.tsx$/.test(f));
    expect(boundaries).toContain(join(ADMIN, 'error.tsx'));
    for (const f of boundaries) {
      const src = readFileSync(f, 'utf8');
      expect(src.startsWith("'use client';\n"), `${f} must start with 'use client'`).toBe(true);
      expect(src, `${f} must default-export the boundary and take Next 16.3's retry prop`).toMatch(
        /^export default function \w+\(\{ error, retry \}/m,
      );
    }
  });

  it('no two admin files use the same element id', () => {
    // Cache Components keeps a page you left mounted but hidden (<Activity>), so the sign-in
    // and reset forms can be in the document together: a shared id="email" sends the label,
    // and aria-describedby, to the hidden input.
    const owners = new Map<string, Set<string>>();
    for (const f of all) {
      for (const [, id] of readFileSync(f, 'utf8').matchAll(/\bid="([^"]+)"/g)) owners.set(id, (owners.get(id) ?? new Set()).add(f));
    }
    const shared = [...owners].filter(([, where]) => where.size > 1);
    expect(shared.map(([id, where]) => `${id}: ${[...where].join(', ')}`)).toEqual([]);
  });

  it('no inline style attributes', () => {
    expect(all.filter((f) => /\bstyle=\{/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('a form that submits from onSubmit, or has no action, says method="post"', () => {
    // submitKeepingValues (lib/admin/form.ts) submits from onSubmit. Before hydration the browser submits
    // instead, and a form with no method is a GET that puts every field (guest names, phones, emails, notes,
    // reasons) in the URL, the history and the server's logs. A function action={…} is exempt: React posts
    // it itself (and warns if a method is given). A path action="/…" with no onSubmit is a search or filter.
    const forms: string[] = [];
    const missing: string[] = [];
    for (const f of all.filter((path) => path.endsWith('.tsx'))) {
      const src = readFileSync(f, 'utf8');
      walk(parseSync(f, src).program, (n) => {
        const name = n.name as JsxNode | undefined;
        if (n.type !== 'JSXOpeningElement' || name?.type !== 'JSXIdentifier' || name.name !== 'form') return;
        const where = `${relative('.', f)}:${src.slice(0, n.start as number).split('\n').length}`;
        forms.push(where);
        const attrs = new Map(
          (n.attributes as JsxNode[]).filter((a) => a.type === 'JSXAttribute').map((a) => [(a.name as JsxNode).name as string, a.value as JsxNode | null]),
        );
        const action = attrs.get('action');
        const expression = action?.type === 'JSXExpressionContainer' ? (action.expression as JsxNode) : null;
        const functionAction = !!expression && expression.type !== 'Literal' && expression.type !== 'TemplateLiteral';
        const method = attrs.get('method');
        const posts = method?.type === 'Literal' && String(method.value).toLowerCase() === 'post';
        if (!functionAction && (attrs.has('onSubmit') || !attrs.has('action')) && !posts) missing.push(where);
      });
    }
    // The scan sees the admin's forms (sign-in, the booking screens, the search and filters).
    expect(forms.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });
});

type JsxNode = { type: string; [key: string]: unknown };

function walk(node: unknown, visit: (n: JsxNode) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null || typeof (node as JsxNode).type !== 'string') return;
  visit(node as JsxNode);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}
