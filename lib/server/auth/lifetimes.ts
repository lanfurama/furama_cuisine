/*
 * How long the staff links work. One constant each, read both by the code
 * that enforces the lifetime and by the email that states it, so the two
 * cannot drift apart (phase-3 ledger). No server-only import: config.ts is
 * also loaded by the auth CLI and the bootstrap script.
 */

/** Spec §7.1: an invitation link works for 7 days (staff_invitation.expires_at). */
export const INVITE_TTL_DAYS = 7;

/** A password-reset link works for an hour (Better Auth's resetPasswordTokenExpiresIn). */
export const RESET_TOKEN_SECONDS = 60 * 60;
