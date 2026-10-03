import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * A guest page reads its content for the language in its URL, so it checks
 * that language before it reads anything: `await requireEnabledLocale(…)`
 * (lib/server/content/locales.ts). The (guarded) layout's own check is not
 * enough, since layouts and pages render in parallel
 * (node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:460):
 * /favicon.ico would query the database with "favicon.ico" as its language,
 * and the page's error would win over the layout's 404. Reading the language
 * itself (`await lang()`, `await params`) may come first; a page that awaits
 * nothing else reads nothing. Awaits inside nested functions are not counted:
 * they run only when called. The admin's session rule is the same check
 * (lib/admin/admin-pages.guard.test.ts).
 */
const GUEST = 'app/(site)';
const CHECK = 'requireEnabledLocale';
const FUNCTIONS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

type Node = { type: string; [key: string]: unknown };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Visits every node below `node`; a node for which `skip` is true is neither visited nor entered. */
function walk(node: unknown, visit: (n: Node) => void, skip?: (n: Node) => boolean): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, skip));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  if (skip?.(node as Node)) return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit, skip);
}

/** `export default async function Page…`: every guest page is written so. */
function defaultExportFunction(program: Node): Node | null {
  const exported = (program.body as Node[]).find((n) => n.type === 'ExportDefaultDeclaration')?.declaration as Node | undefined;
  return exported && FUNCTIONS.includes(exported.type) ? exported : null;
}

/** `await lang()` or `await params`: reading the language, not content. */
function readsLanguage(argument: Node): boolean {
  if (argument.type === 'Identifier') return argument.name === 'params';
  const callee = argument.type === 'CallExpression' ? (argument.callee as Node) : null;
  return callee?.type === 'Identifier' && callee.name === 'lang';
}

/** Null when the page's first await past the language is `await requireEnabledLocale(…)`, or it has none; otherwise why not. */
function languageCheckProblem(file: string, src: string): string | null {
  const page = defaultExportFunction(parseSync(file, src).program as unknown as Node);
  if (!page) return 'no `export default async function` to check';
  const awaits: Node[] = [];
  walk(
    page.body,
    (n) => {
      if (n.type === 'AwaitExpression') awaits.push(n);
    },
    (n) => FUNCTIONS.includes(n.type),
  );
  const unwrap = (n: Node): Node => (n.type === 'ParenthesizedExpression' ? unwrap(n.expression as Node) : n);
  const first = awaits
    .sort((a, b) => (a.start as number) - (b.start as number))
    .find((n) => !readsLanguage(unwrap(n.argument as Node)));
  if (!first) return null;
  const argument = unwrap(first.argument as Node);
  const callee = argument.type === 'CallExpression' ? (argument.callee as Node) : null;
  if (callee?.type === 'Identifier' && callee.name === CHECK) return null;
  const line = src.slice(0, first.start as number).split('\n').length;
  return `line ${line} awaits \`${src.slice(first.start as number, first.end as number)}\` before ${CHECK}()`;
}

describe('guest pages', () => {
  it('every page checks its language before it reads anything', () => {
    const pages = files(GUEST).filter((f) => f.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(3); // home, privacy, a restaurant's page
    const problems = pages.flatMap((f) => {
      const problem = languageCheckProblem(f, readFileSync(f, 'utf8'));
      return problem ? [`${relative('.', f)}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it('the language-first rule: lang() and params may come first; a read before the check is flagged', () => {
    const compliant = [
      'export default async function Page({ params }) {',
      '  const { lang, slug } = await params;',
      '  await requireEnabledLocale(lang);',
      '  const detail = await getRestaurantDetail(slug, lang);',
      '  return <p>{detail.name}</p>;',
      '}',
    ].join('\n');
    expect(languageCheckProblem('compliant.tsx', compliant)).toBeNull();
    const readsFirst = [
      'export default async function Page() {',
      '  const locale = (await lang()) ?? DEFAULT_LOCALE;',
      '  const [stories] = await Promise.all([getStories(locale)]);',
      '  return <p>{stories.length}</p>;',
      '}',
    ].join('\n');
    expect(languageCheckProblem('reads-first.tsx', readsFirst)).toBe(
      'line 3 awaits `await Promise.all([getStories(locale)])` before requireEnabledLocale()',
    );
    expect(languageCheckProblem('static.tsx', 'export default async function Page() {\n  return <p />;\n}')).toBeNull();
  });
});
