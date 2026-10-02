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
    const forms: string[] = [];
    const missing: string[] = [];
    for (const f of all.filter((path) => path.endsWith('.tsx'))) {
      for (const { line, lacksPost } of checkForms(f, readFileSync(f, 'utf8'))) {
        forms.push(`${relative('.', f)}:${line}`);
        if (lacksPost) missing.push(`${relative('.', f)}:${line}`);
      }
    }
    // The scan sees the admin's forms (sign-in, the booking screens, the search and filters).
    expect(forms.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it('the method="post" rule: onSubmit needs it whatever the action; only a form without onSubmit may rest on its action', () => {
    const fixture = [
      'export function Forms({ action, href }) {',
      '  return (',
      '    <>',
      '      <form action={href} onSubmit={submitKeepingValues(action)} />',
      '      <form action={action} />',
      '      <form action="/admin/x" />',
      '      <form method="post" onSubmit={submitKeepingValues(action)} />',
      '      <form />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(checkForms('fixture.tsx', fixture)).toEqual([
      { line: 4, lacksPost: true },
      { line: 5, lacksPost: false },
      { line: 6, lacksPost: false },
      { line: 7, lacksPost: false },
      { line: 8, lacksPost: true },
    ]);
  });

  it('every page awaits the session check before anything else', () => {
    // (auth) pages serve people without a session (sign-in, reset, invitation: they read a token from the
    // URL first), and [...missing] calls notFound() and reads nothing. Every other admin page, including any
    // new one outside (shell), is scanned.
    const ALLOWED = [/^app\/admin\/\(auth\)\//, /^app\/admin\/\[\.\.\.missing\]\/page\.tsx$/];
    const pages = all.filter((f) => f.endsWith('/page.tsx') && !ALLOWED.some((re) => re.test(f)));
    expect(pages.filter((f) => f.startsWith('app/admin/(shell)/')).length).toBeGreaterThan(10);
    const problems = pages.flatMap((f) => {
      const problem = sessionCheckProblem(f, readFileSync(f, 'utf8'));
      return problem ? [`${relative('.', f)}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it('the session-first rule: awaits inside nested functions do not count; a query before the check is flagged', () => {
    const compliant = [
      'export default async function Page({ searchParams }) {',
      "  const label = async () => (await getPool().query('SELECT 1')).rows;",
      "  const staff = await requirePagePermission({ reservations: ['read'] });",
      '  const { q } = await searchParams;',
      "  const { rows } = await getPool().query('SELECT 1');",
      '  return <p>{staff.name}{q}{rows.length}{label.length}</p>;',
      '}',
    ].join('\n');
    expect(sessionCheckProblem('compliant.tsx', compliant)).toBeNull();
    const queriesFirst = [
      'export default async function Page() {',
      "  const { rows } = await getPool().query('SELECT 1');",
      "  await requirePagePermission({ reservations: ['read'] });",
      '  return <p>{rows.length}</p>;',
      '}',
    ].join('\n');
    expect(sessionCheckProblem('queries-first.tsx', queriesFirst)).toBe(
      "line 2 awaits `await getPool().query('SELECT 1')` before verifySession() or requirePagePermission()",
    );
  });
});

type JsxNode = { type: string; [key: string]: unknown };

/**
 * Every <form> of a file, by line, and whether it lacks the method="post" it needs.
 * submitKeepingValues (lib/admin/form.ts) submits from onSubmit. Before hydration the browser submits
 * instead, to the form's action, and a form with no method is a GET that puts every field (guest names,
 * phones, emails, notes, reasons) in the URL, the history and the server's logs. So a form with onSubmit
 * says method="post" whatever its action is: a non-literal action={href} may well be a string. Only a form
 * without onSubmit may rest on its action: a function action={…} React posts itself (and warns if a method
 * is given); a path action="/…" is a search or a filter, a GET by design. A form with neither is a GET too.
 * So a form with a function action takes no onSubmit: a confirm() goes on its submit button (DeleteClosure).
 */
function checkForms(file: string, src: string): { line: number; lacksPost: boolean }[] {
  const forms: { line: number; lacksPost: boolean }[] = [];
  walk(parseSync(file, src).program, (n) => {
    const name = n.name as JsxNode | undefined;
    if (n.type !== 'JSXOpeningElement' || name?.type !== 'JSXIdentifier' || name.name !== 'form') return;
    const attrs = new Map(
      (n.attributes as JsxNode[]).filter((a) => a.type === 'JSXAttribute').map((a) => [(a.name as JsxNode).name as string, a.value as JsxNode | null]),
    );
    const method = attrs.get('method');
    const posts = method?.type === 'Literal' && String(method.value).toLowerCase() === 'post';
    const needsPost = attrs.has('onSubmit') || !attrs.has('action');
    forms.push({ line: lineOf(src, n), lacksPost: needsPost && !posts });
  });
  return forms;
}

const SESSION_CHECKS = ['verifySession', 'requirePagePermission'];
const FUNCTIONS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

/**
 * Null when the first await of the page's default-export function, in source order, is
 * `await verifySession(…)` or `await requirePagePermission(…)`; otherwise why not. Code rule: an admin page
 * checks the session before it reads anything. The (shell) layout's check is not enough: layouts do not
 * re-render on navigation (node_modules/next/dist/docs/01-app/02-guides/authentication.md:1352), and
 * layouts and pages render in parallel (01-app/01-getting-started/06-fetching-data.md:460). Awaits inside
 * nested functions are not counted: they run only when called.
 */
function sessionCheckProblem(file: string, src: string): string | null {
  const page = defaultExportFunction(parseSync(file, src).program as unknown as JsxNode);
  if (!page) return 'no default-export function to check';
  const awaits: JsxNode[] = [];
  walk(
    page.body,
    (n) => {
      if (n.type === 'AwaitExpression') awaits.push(n);
    },
    (n) => FUNCTIONS.includes(n.type),
  );
  const first = awaits.sort((a, b) => (a.start as number) - (b.start as number))[0];
  if (!first) return 'awaits nothing, so it never checks the session';
  let argument = first.argument as JsxNode;
  while (argument.type === 'ParenthesizedExpression') argument = argument.expression as JsxNode;
  const callee = argument.type === 'CallExpression' ? (argument.callee as JsxNode) : null;
  if (callee?.type === 'Identifier' && SESSION_CHECKS.includes(callee.name as string)) return null;
  const text = src.slice(first.start as number, first.end as number);
  return `line ${lineOf(src, first)} awaits \`${text}\` before verifySession() or requirePagePermission()`;
}

/** `export default async function Page…`, or `export default Page` naming a top-level function. */
function defaultExportFunction(program: JsxNode): JsxNode | null {
  const body = program.body as JsxNode[];
  const exported = body.find((n) => n.type === 'ExportDefaultDeclaration')?.declaration as JsxNode | undefined;
  if (!exported) return null;
  if (FUNCTIONS.includes(exported.type)) return exported;
  if (exported.type !== 'Identifier') return null;
  for (const n of body) {
    const declaration = (n.type === 'ExportNamedDeclaration' ? n.declaration : n) as JsxNode | null;
    if (declaration?.type === 'FunctionDeclaration' && (declaration.id as JsxNode | null)?.name === exported.name) return declaration;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const d of declaration.declarations as JsxNode[]) {
      const init = d.init as JsxNode | null;
      if ((d.id as JsxNode).name === exported.name && init && FUNCTIONS.includes(init.type)) return init;
    }
  }
  return null;
}

const lineOf = (src: string, n: JsxNode) => src.slice(0, n.start as number).split('\n').length;

/** Visits every node below `node`; a node for which `skip` is true is neither visited nor entered. */
function walk(node: unknown, visit: (n: JsxNode) => void, skip?: (n: JsxNode) => boolean): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, skip));
  if (typeof node !== 'object' || node === null || typeof (node as JsxNode).type !== 'string') return;
  if (skip?.(node as JsxNode)) return;
  visit(node as JsxNode);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit, skip);
}
