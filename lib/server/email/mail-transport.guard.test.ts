import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every email goes through lib/server/email/send.ts, the only place that
 * honours EMAIL_DELIVERY (spec §10.4: log by default, redirect on previews,
 * live in production). A second nodemailer transport elsewhere would send real
 * mail from CI or a preview. smtp-server (the local sink of the tests) stays
 * under test/; Resend is gone (user decision: SMTP).
 */
const ROOT = join(__dirname, '..', '..', '..');
const SCAN = ['app', 'lib', 'components', 'db', 'scripts', 'e2e', 'proxy.ts'];
const ALLOWED = 'lib/server/email/';

function files(path: string): string[] {
  const full = join(ROOT, path);
  try {
    return readdirSync(full, { withFileTypes: true }).flatMap((e) => files(join(path, e.name)));
  } catch {
    return /\.(ts|tsx|mjs|js)$/.test(path) ? [full] : [];
  }
}

const importOf = (name: string) => new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${name}(?:/[^'"]*)?['"]`);
const NODEMAILER = importOf('nodemailer');
const SMTP_SERVER = importOf('smtp-server');
const RESEND = importOf('resend');

// This file names the packages in its own examples.
const sources = () => SCAN.flatMap(files).map((f) => relative(ROOT, f)).filter((f) => f !== relative(ROOT, __filename));
const importing = (pattern: RegExp, list: string[]) => list.filter((f) => pattern.test(readFileSync(join(ROOT, f), 'utf8')));

describe('mail transport imports', () => {
  it('only lib/server/email imports nodemailer', () => {
    expect(importing(NODEMAILER, sources().filter((f) => !f.startsWith(ALLOWED)))).toEqual([]);
  });

  it('nothing outside test/ imports smtp-server, and nothing imports resend', () => {
    expect(importing(SMTP_SERVER, sources())).toEqual([]);
    expect(importing(RESEND, sources())).toEqual([]);
  });

  it('recognises the import forms it is looking for', () => {
    for (const line of [
      `import nodemailer from 'nodemailer';`,
      `import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';`,
      `const m = await import("nodemailer")`,
      `require('nodemailer')`,
    ]) {
      expect(NODEMAILER.test(line)).toBe(true);
    }
    expect(NODEMAILER.test(`import { sendEmail } from '@/lib/server/email/send';`)).toBe(false);
    expect(SMTP_SERVER.test(`import { SMTPServer } from 'smtp-server';`)).toBe(true);
  });
});
