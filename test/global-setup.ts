import { execFileSync } from 'node:child_process';

/** Rebuilds the integration database once per run. Without TEST_DATABASE_URL the integration tests skip. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execFileSync(process.execPath, ['scripts/reset-db.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, RESET_DATABASE_URL: url },
  });
}
