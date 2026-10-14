import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * Phase 9 (spec §9.4): one gate to Vertex. Only files under lib/server/ai/ may
 * import the AI SDK, its providers, google-auth-library or @vercel/oidc, so
 * the budget, the per-person limit and the keyless auth cannot be bypassed.
 * Two narrow exceptions: @ai-sdk/react (useCompletion) in the assist panel,
 * and `ai` itself (createTextStreamResponse, toTextStream) in the AI route
 * handlers. Nothing under lib/server/ai/ may reach guest data: no booking or
 * email module and no `reservations` (spec §9.4: never send guests' personal
 * data to Vertex). Tests and test helpers are not app code.
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
const ASSIST_PANEL = 'app/admin/(shell)/_kit/AssistPanel.tsx';
const AI_ROUTE = /^app\/api\/admin\/ai\/.+\/route\.ts$/;


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
      if (rel.startsWith(GATE)) return packageOf(m) === '@ai-sdk/react';
      if (packageOf(m) === '@ai-sdk/react') return rel !== ASSIST_PANEL;
      if (m === 'ai') return !AI_ROUTE.test(rel);
      return true;
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

  it('what it catches: any form of import, the wrong place for the two exceptions, guest data', () => {
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
    // The two exceptions are narrow.
    expect(aiImportProblems(ASSIST_PANEL, "import { useCompletion } from '@ai-sdk/react';")).toEqual([]);
    expect(aiImportProblems('lib/x.ts', "import { openai } from '@ai-sdk/openai';")).toEqual(['lib/x.ts: imports @ai-sdk/openai']);
    expect(aiImportProblems('app/x/Other.tsx', "import { useCompletion } from '@ai-sdk/react';")).toEqual(['app/x/Other.tsx: imports @ai-sdk/react']);
    expect(aiImportProblems('app/api/admin/ai/assist/route.ts', "import { createTextStreamResponse } from 'ai';")).toEqual([]);
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
