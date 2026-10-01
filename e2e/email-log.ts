import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

/*
 * The server under test runs with EMAIL_DELIVERY=log and EMAIL_LOG_FILE set,
 * so lib/server/email/send.ts appends every email it would send to that file
 * as one JSON line. This is how a spec reads an invitation or reset link.
 */

type LoggedEmail = { to: string; subject: string; text: string };

function file(): string {
  const path = process.env.EMAIL_LOG_FILE;
  if (!path) throw new Error('Set EMAIL_LOG_FILE (the server writes emails there) to run the admin email specs.');
  return path;
}

export function emailsTo(to: string): LoggedEmail[] {
  let raw: string;
  try {
    raw = readFileSync(file(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedEmail)
    .filter((e) => e.to === to);
}

/**
 * Waits for an email to `to` beyond the first `seen` ones and returns its
 * link to `path` (/admin/accept-invite or /admin/reset-password).
 */
export async function nextLink(to: string, path: string, seen = 0): Promise<string> {
  const pattern = new RegExp(`https?://[^\\s]+${path.replace(/\//g, '\\/')}\\?token=[A-Za-z0-9_%-]+`);
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const fresh = emailsTo(to).slice(seen);
        link = fresh.at(-1)?.text.match(pattern)?.[0];
        return link;
      },
      { message: `an email to ${to} with a ${path} link`, timeout: 10_000 },
    )
    .toBeTruthy();
  return link!;
}
