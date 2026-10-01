/*
 * Tests must never reach a real database. Integration tests opt in with
 * TEST_DATABASE_URL (a local throwaway database, see scripts/reset-db.mjs);
 * without it, DATABASE_URL is cleared so nothing can fall back to Neon.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}
