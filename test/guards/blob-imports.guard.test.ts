import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * Spec §11, outline X3 and F13: a @vercel/blob call that is not given
 * credentials resolves them by itself, and on a developer's linked checkout
 * @vercel/oidc then mints a token through the Vercel API, from a local run.
 * So the package is imported only where the credentials rule is kept:
 * lib/server/media/blob.ts (every server call, with blobCredentials()), the
 * browser's uploader and the token route (the presigned flow of
 * @vercel/blob/client: the browser never holds a token, the route issues it
 * through blob.ts), and the move script, which passes its explicit token.
 * Each task that adds one of those files adds its line here; tests and test
 * helpers are not app code.
 */

const ROOT = join(__dirname, '..', '..');
const SCAN = ['app', 'components', 'lib', 'scripts', 'db', 'proxy.ts', 'instrumentation-client.ts', 'next.config.ts'];
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const NOT_APP = /\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

/** File → the one @vercel/blob entry point it may import. */
const ALLOWED: Record<string, string> = {
  'lib/server/media/blob.ts': '@vercel/blob',
  // The presigned flow (spec §11): the browser asks the route for a URL, the route issues it through blob.ts.
  'app/admin/(shell)/_kit/MediaUploader.tsx': '@vercel/blob/client',
  'app/api/admin/media/upload/route.ts': '@vercel/blob/client',
  // Run by the controller with the store's token on the command line (README "Media in Vercel Blob").
  'scripts/move-assets-to-blob.mjs': '@vercel/blob',
};

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

/** The @vercel/blob imports a file may not make. */
function blobImportProblems(rel: string, src: string, allowed: Record<string, string> = ALLOWED): string[] {
  return moduleRequests(rel, src)
    .filter((m) => m === '@vercel/blob' || m.startsWith('@vercel/blob/'))
    .filter((m) => allowed[rel] !== m)
    .map((m) => `${rel}: imports ${m}`);
}

describe('@vercel/blob imports (spec §11: explicit credentials only)', () => {
  const all = SCAN.flatMap(files);

  it('only the files on the list import it, each its own entry point', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.flatMap((rel) => blobImportProblems(rel, readFileSync(join(ROOT, rel), 'utf8')))).toEqual([]);
  });

  it('every file on the list still imports it (a moved one would leave a stale exception)', () => {
    for (const [rel, entry] of Object.entries(ALLOWED)) {
      expect(moduleRequests(rel, readFileSync(join(ROOT, rel), 'utf8')), rel).toContain(entry);
    }
  });

  it('what it catches: static, re-exported, dynamic and required imports, and the wrong entry point', () => {
    const fixture = [
      "import { put } from '@vercel/blob';",
      "export * from '@vercel/blob/client';",
      "const blob = await import('@vercel/blob');",
      "const { del } = require('@vercel/blob');",
      "import { z } from 'zod';",
    ].join('\n');
    expect(blobImportProblems('lib/x.ts', fixture)).toEqual([
      'lib/x.ts: imports @vercel/blob',
      'lib/x.ts: imports @vercel/blob/client',
      'lib/x.ts: imports @vercel/blob',
      'lib/x.ts: imports @vercel/blob',
    ]);
    expect(blobImportProblems('lib/server/media/blob.ts', "import { head } from '@vercel/blob';")).toEqual([]);
    expect(blobImportProblems('lib/server/media/blob.ts', "import { upload } from '@vercel/blob/client';")).toEqual([
      'lib/server/media/blob.ts: imports @vercel/blob/client',
    ]);
  });
});
