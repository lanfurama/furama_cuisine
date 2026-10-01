/*
 * For the Better Auth CLI only:
 *   PGHOST= PGUSER= PGPASSWORD= PGDATABASE= \
 *   AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<name>_test \
 *     npx auth check --config scripts/auth-cli.config.ts
 * (`generate` takes the same --config). The CLI introspects the database to
 * diff the schema, and it loads .env and .env.local by itself, which point at
 * the shared Neon database. So this file reads a variable of its own and
 * refuses anything but a local database. Never run `npx auth migrate`:
 * migrations are db/migrations/*.sql.
 */
import { Pool } from 'pg';
import { createAuth } from '../lib/server/auth/config';

const url = process.env.AUTH_CLI_DATABASE_URL;
if (!url) throw new Error('Set AUTH_CLI_DATABASE_URL to a local postgres://localhost:5432/<name>_test database.');
const parsed = new URL(url);
// pg lets a query string (?host=...) override the hostname, so none is allowed.
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.search !== '') {
  throw new Error(`Refusing ${parsed.hostname}: the Better Auth CLI only runs against a local database.`);
}

// The CLI has already copied .env.local into process.env for every key the
// shell left unset (node_modules/c12/dist/index.mjs:24), and pg fills what the
// URL leaves out (user, password, sslmode) from PG* variables: drop them all,
// so no Neon credential is ever offered to the local server. (A local server
// that needs a user takes it in the URL: postgres://me@localhost:5432/….)
for (const key of Object.keys(process.env)) if (key.startsWith('PG')) delete process.env[key];

export const auth = createAuth({
  pool: new Pool({ connectionString: url }),
  secret: 'cli-only-secret-cli-only-secret-0000',
  baseURL: 'http://localhost:3000',
  bootstrapAdminEmail: undefined,
  sendResetPassword: async () => {},
});
