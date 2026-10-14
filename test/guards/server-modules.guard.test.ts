import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * .claude/architecture.md: each folder of lib/server is a module, the files
 * at its top are the kernel. The kernel imports no module, and no two modules
 * import each other, directly or round a loop: a module that needs one
 * further up is handed it by its caller (ReservationEffects, which app/ fills
 * with lib/server/email's outboxEffects()). Type imports count too: they tie
 * the two modules' code together all the same. Tests are not app code.
 */

const ROOT = join(__dirname, '..', '..');
const SERVER = 'lib/server';
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const NOT_APP = /\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const KERNEL = 'kernel';

type Node = { type: string; [key: string]: unknown };
type Edge = { from: string; to: string; file: string; request: string };

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return SOURCE.test(path) && !NOT_APP.test(path) ? [path] : [];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

/** Every module a file loads: import/export … from, import(). */
function moduleRequests(file: string, src: string): string[] {
  const found: string[] = [];
  walk(parseSync(file, src).program, (n) => {
    const l = n.source as Node | undefined;
    const isSource = n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ImportExpression';
    if (isSource && l && (l.type === 'Literal' || l.type === 'StringLiteral') && typeof l.value === 'string') found.push(l.value);
  });
  return found;
}

/** The module a lib/server path belongs to: its first folder, or the kernel for a top-level file. */
function moduleOf(path: string): string | null {
  if (!path.startsWith(`${SERVER}/`)) return null;
  const rest = path.slice(SERVER.length + 1).split('/');
  return rest.length === 1 ? KERNEL : rest[0];
}

/** The lib/server path a request names, as seen from `file`; null for anything outside lib/server. */
function target(file: string, request: string): string | null {
  const path = request.startsWith('@/') ? request.slice(2) : request.startsWith('.') ? normalize(join(dirname(file), request)) : null;
  return path && path.startsWith(`${SERVER}/`) ? path : null;
}

function edgesOf(file: string, src: string): Edge[] {
  const from = moduleOf(file);
  if (!from) return [];
  return moduleRequests(file, src).flatMap((request) => {
    const path = target(file, request);
    const to = path && moduleOf(path);
    return to && to !== from ? [{ from, to, file, request }] : [];
  });
}

/** Each loop between modules once, as the edges that make it (Tarjan's strongly connected components). */
function loops(edges: Edge[]): string[][] {
  const next = new Map<string, Set<string>>();
  for (const e of edges) next.set(e.from, (next.get(e.from) ?? new Set()).add(e.to));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const found: string[][] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (stack.includes(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const component: string[] = [];
    for (let w = stack.pop()!; ; w = stack.pop()!) {
      component.push(w);
      if (w === v) break;
    }
    if (component.length > 1) {
      const members = new Set(component);
      found.push(
        edges
          .filter((e) => members.has(e.from) && members.has(e.to))
          .map((e) => `${e.from} -> ${e.to}: ${e.file} imports ${e.request}`)
          .sort(),
      );
    }
  };
  for (const v of next.keys()) if (!index.has(v)) visit(v);
  return found;
}

describe('lib/server modules (.claude/architecture.md)', () => {
  const edges = files(SERVER).flatMap((f) => edgesOf(f, readFileSync(join(ROOT, f), 'utf8')));

  it('reads the modules', () => {
    expect(edges.length).toBeGreaterThan(20);
  });

  it('the kernel imports no module', () => {
    expect(edges.filter((e) => e.from === KERNEL).map((e) => `${e.file} imports ${e.request}`)).toEqual([]);
  });

  it('no two modules import each other, directly or round a loop', () => {
    expect(loops(edges)).toEqual([]);
  });

  it('what it reads: aliased, relative, re-exported and dynamic imports, by module', () => {
    const fixture = [
      "import type { Db } from '@/db/client';",
      "import { a } from '@/lib/server/booking/rules';",
      "export { b } from '../content/site';",
      "const c = await import('@/lib/server/audit');",
      "import { d } from './lock';",
    ].join('\n');
    expect(edgesOf('lib/server/email/x.ts', fixture).map((e) => `${e.from} -> ${e.to}`)).toEqual([
      'email -> booking',
      'email -> content',
      'email -> kernel',
    ]);
    expect(moduleOf('lib/server/audit.ts')).toBe(KERNEL);
    expect(moduleOf('lib/admin/nav.ts')).toBeNull();
  });

  it('what it catches: a loop of two and a loop of three, once each', () => {
    const e = (from: string, to: string): Edge => ({ from, to, file: `${from}.ts`, request: to });
    expect(loops([e('a', 'b'), e('b', 'a'), e('c', 'd'), e('d', 'e'), e('e', 'c'), e('a', 'c')])).toEqual([
      ['c -> d: c.ts imports d', 'd -> e: d.ts imports e', 'e -> c: e.ts imports c'],
      ['a -> b: a.ts imports b', 'b -> a: b.ts imports a'],
    ]);
    expect(loops([e('a', 'b'), e('b', 'c')])).toEqual([]);
  });
});
