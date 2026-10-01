import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every email goes through lib/server/email/send.ts, the only place that
 * honours EMAIL_DELIVERY (spec §10.4: log by default, redirect on previews,
 * live in production). A second `new Resend(...)` elsewhere would send real
 * mail from CI or a preview.
 */
const ROOT = join(__dirname, '..', '..', '..');
const SCAN = ['app', 'lib', 'components', 'db', 'scripts', 'proxy.ts'];
const ALLOWED = 'lib/server/email/';

function files(path: string): string[] {
  const full = join(ROOT, path);
  try {
    return readdirSync(full, { withFileTypes: true }).flatMap((e) => files(join(path, e.name)));
  } catch {
    return /\.(ts|tsx|mjs|js)$/.test(path) ? [full] : [];
  }
}

const IMPORTS_RESEND = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]resend(?:\/[^'"]*)?['"]/;

describe('resend imports', () => {
  it('only lib/server/email imports the Resend SDK', () => {
    const offenders = SCAN.flatMap(files)
      .map((f) => relative(ROOT, f))
      .filter((f) => !f.startsWith(ALLOWED) && IMPORTS_RESEND.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('recognises the import forms it is looking for', () => {
    for (const line of [`import { Resend } from 'resend';`, `const { Resend } = await import("resend")`, `require('resend')`]) {
      expect(IMPORTS_RESEND.test(line)).toBe(true);
    }
    expect(IMPORTS_RESEND.test(`import { sendEmail } from '@/lib/server/email/send';`)).toBe(false);
  });
});
