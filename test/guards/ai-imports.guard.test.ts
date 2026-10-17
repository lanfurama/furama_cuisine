import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * Phase 9 (spec §9.4): one gate to Vertex. Only files under lib/server/ai/ may
 * import the AI SDK, its providers, google-auth-library or @vercel/oidc, so
 * the budget, the per-person limit and the keyless auth cannot be bypassed.
 * There is no exception: the AI route handlers call the gate (the assistant's
 * stream is built in lib/server/ai/assist.ts), so none imports `ai` itself.
 * No AI package reaches the browser bundle: the writing assistant's panel
 * reads its stream with fetch (R9-23), and @ai-sdk/react is not even a
 * dependency. Nothing under lib/server/ai/ may
 * reach guest data: no booking or email module and no `reservations` (spec
 * §9.4: never send guests' personal data to Vertex). Tests and test helpers
 * are not app code.
 */

const ROOT = join(__dirname, '..', '..');
const SCAN = ['app', 'components', 'lib', 'scripts', 'db', 'proxy.ts', 'instrumentation-client.ts', 'next.config.ts'];
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const NOT_APP = /\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

/** The packages that are the gate's; a module request is checked by its package name. */
const RESTRICTED = new Set(['ai', 'google-auth-library', '@vercel/oidc']);
/** Every @ai-sdk/* package is the gate's (providers and @ai-sdk/react alike). */
const restricted = (m: string) => RESTRICTED.has(packageOf(m)) || m.startsWith('@ai-sdk/');
const GATE = 'lib/server/ai/';


type Node = { type: string; [key: string]: unknown };

function files(path: string): string[] {
  const full = join(ROOT, path);
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    return SOURCE.test(path) && !NOT_APP.test(path) ? [path] : [];
  }
  return entries.flatMap((e) => (e.name === 'node_modules' || e.name.startsWith('.') ? [] : files(join(path, e.name))));
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

/** Every module a file loads: import/export … from, import(), require(). */
function moduleRequests(file: string, src: string): string[] {
  const found: string[] = [];
  walk(parseSync(file, src).program, (n) => {
    const literal = (x: unknown) => {
      const l = x as Node | undefined;
      if (l && (l.type === 'Literal' || l.type === 'StringLiteral') && typeof l.value === 'string') found.push(l.value);
    };
    if (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') literal(n.source);
    if (n.type === 'ImportExpression') literal(n.source);
    if (n.type === 'CallExpression' && (n.callee as Node).type === 'Identifier' && (n.callee as Node).name === 'require') literal((n.arguments as unknown[])[0]);
  });
  return found;
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
const packageOf = (m: string) => (m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0]);

/** The problems a file has: restricted imports outside the gate, guest data inside it. */
function aiImportProblems(rel: string, src: string): string[] {
  const requests = moduleRequests(rel, src);
  const problems = requests
    .filter(restricted)
    .filter((m) => {
      if (packageOf(m) === '@ai-sdk/react') return true;
      return !rel.startsWith(GATE);
    })
    .map((m) => `${rel}: imports ${m}`);
  if (rel.startsWith(GATE)) {
    for (const m of requests) {
      if (/(^|\/)(booking|email)(\/|$)/.test(m) && (m.startsWith('@/') || m.startsWith('.'))) problems.push(`${rel}: imports ${m} (guest data)`);
    }
    if (/reservations/i.test(src)) problems.push(`${rel}: mentions reservations (guest data)`);
  }
  return problems;
}

describe('AI imports (spec §9.4: one gate to Vertex)', () => {
  const all = SCAN.flatMap(files);

  it('only lib/server/ai/ imports the AI packages, and it never touches guest data', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((f) => f.startsWith(GATE))).toBe(true);
    expect(all.flatMap((rel) => aiImportProblems(rel, readFileSync(join(ROOT, rel), 'utf8')))).toEqual([]);
  });

  it('no AI package is a dependency the browser could load (R9-23: no @ai-sdk/react)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => d === '@ai-sdk/react' || d === 'swr')).toEqual([]);
  });

  it('what it catches: any form of import, anywhere outside the gate (route handlers too), guest data', () => {
    const fixture = [
      "import { generateText } from 'ai';",
      "import { MockLanguageModelV4 } from 'ai/test';",
      "export * from '@ai-sdk/google-vertex/anthropic';",
      "const g = await import('@ai-sdk/google');",
      "const a = require('google-auth-library');",
      "import { getVercelOidcToken } from '@vercel/oidc';",
      "import { z } from 'zod';",
      "import { aiFoo } from '@/lib/aiish';",
    ].join('\n');
    expect(aiImportProblems('lib/x.ts', fixture)).toEqual([
      'lib/x.ts: imports ai',
      'lib/x.ts: imports ai/test',
      'lib/x.ts: imports @ai-sdk/google-vertex/anthropic',
      'lib/x.ts: imports @ai-sdk/google',
      'lib/x.ts: imports google-auth-library',
      'lib/x.ts: imports @vercel/oidc',
    ]);
    // Inside the gate everything but the React hook is fine.
    expect(aiImportProblems('lib/server/ai/client.ts', fixture)).toEqual([]);
    expect(aiImportProblems('lib/server/ai/x.ts', "import { useCompletion } from '@ai-sdk/react';")).toEqual(['lib/server/ai/x.ts: imports @ai-sdk/react']);
    // The React hook has no exception left, not even in the assist panel (R9-23).
    expect(aiImportProblems('app/admin/(shell)/_kit/AssistPanel.tsx', "import { useCompletion } from '@ai-sdk/react';")).toEqual([
      'app/admin/(shell)/_kit/AssistPanel.tsx: imports @ai-sdk/react',
    ]);
    expect(aiImportProblems('app/api/admin/ai/assist/route.ts', "import { useCompletion } from '@ai-sdk/react';")).toEqual([
      'app/api/admin/ai/assist/route.ts: imports @ai-sdk/react',
    ]);
    // No exception for the AI route handlers any more: they call the gate.
    expect(aiImportProblems('lib/x.ts', "import { openai } from '@ai-sdk/openai';")).toEqual(['lib/x.ts: imports @ai-sdk/openai']);
    expect(aiImportProblems('app/x/Other.tsx', "import { useCompletion } from '@ai-sdk/react';")).toEqual(['app/x/Other.tsx: imports @ai-sdk/react']);
    expect(aiImportProblems('app/api/admin/ai/assist/route.ts', "import { createTextStreamResponse } from 'ai';")).toEqual([
      'app/api/admin/ai/assist/route.ts: imports ai',
    ]);
    expect(aiImportProblems('app/api/admin/ai/assist/route.ts', "import { MockLanguageModelV4 } from 'ai/test';")).toEqual([
      'app/api/admin/ai/assist/route.ts: imports ai/test',
    ]);
    expect(aiImportProblems('app/api/admin/other/route.ts', "import { toTextStream } from 'ai';")).toEqual(['app/api/admin/other/route.ts: imports ai']);
    // Guest data stays out of the gate.
    expect(aiImportProblems('lib/server/ai/x.ts', "import { book } from '@/lib/server/booking/create';")).toEqual([
      'lib/server/ai/x.ts: imports @/lib/server/booking/create (guest data)',
    ]);
    expect(aiImportProblems('lib/server/ai/x.ts', "import { send } from '@/lib/server/email/send';")).toHaveLength(1);
    expect(aiImportProblems('lib/server/ai/x.ts', "const q = 'SELECT * FROM reservations';")).toEqual(['lib/server/ai/x.ts: mentions reservations (guest data)']);
    expect(aiImportProblems('lib/server/booking/x.ts', "const q = 'SELECT * FROM reservations';")).toEqual([]);
  });
});
