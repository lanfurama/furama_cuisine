import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The controller applies each migration to Neon by hand, from the README's
 * "Deploying" runbook (the plans never touch Neon). A migration added
 * without its runbook, or a check file the runbook never names, is a step
 * someone skips on production. From 006 (the first migration with a
 * runbook) every migration has its "### Migration NNN" section, and every
 * file of db/checks is named in the README.
 */

const ROOT = join(__dirname, '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

describe('the README runbook covers every migration and check (phase 7A)', () => {
  const migrations = readdirSync(join(ROOT, 'db/migrations'))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => f.slice(0, 3))
    .filter((n) => n >= '006');

  it.each(migrations)('migration %s has its "### Migration NNN" section', (n) => {
    expect(README).toMatch(new RegExp(`^### Migration ${n} \\(`, 'm'));
  });

  // Only the .sql checks: a Finder .DS_Store (or any other stray file) is not a runbook step.
  const checks = readdirSync(join(ROOT, 'db/checks')).filter((f) => f.endsWith('.sql'));

  it.each(checks)('db/checks/%s is named in the README', (file) => {
    expect(README).toContain(`db/checks/${file}`);
  });
});
