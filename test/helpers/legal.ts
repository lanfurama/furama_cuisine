/*
 * The English privacy policy versions the migrations record in legal_versions
 * (lib/legal.test.ts pins the newest to the registry's agreed text). A new
 * migration that records a changed wording adds its pair here, after the
 * others; the first stays the seed.
 */

/** Migration 009's seed: the wording in force since phase 5 (lib/legal.ts PRIVACY_POLICY_VERSION). */
export const RECORDED = { version: '2026-10-03', sha256: 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2' };
/** Migration 015: the brand renamed Furama Dining World. The wording in force. */
export const BRAND_RENAME = { version: '2026-10-15', sha256: '77926aacc33be47d2aa8dc6c07ed2b9355ff0a3b954177a3628c1064acd0a003' };

/**
 * Deletes the versions a test's saves added (created_by is the staff id, or
 * NULL from a bare insert) and keeps the ones migrations recorded: 009's
 * 'seed', 015's 'migration 015'. The table is then as a migrated database has it.
 */
export const DELETE_ADDED_POLICY_VERSIONS = `DELETE FROM legal_versions WHERE created_by IS NULL OR NOT (created_by = 'seed' OR created_by LIKE 'migration %')`;
