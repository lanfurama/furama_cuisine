/*
 * Whether an SMTP refusal blames the sending side (the sender address, a
 * relay, the login) instead of the recipient's mailbox (triage ruling 2 of the
 * phase-5 final fix wave). Postfix and Exim with smtpd_delay_reject report
 * such problems at RCPT TO ("553 5.7.1 <a@b>: Sender address rejected: not
 * owned by user", "554 5.7.1 <a@b>: Relay access denied"), so a 5xx there is
 * not always about the address. The sender (lib/server/email/send.ts) retries
 * such a refusal, since fixing EMAIL_FROM or the login lets it through; the
 * admin hints (lib/admin/auth-errors.ts) name EMAIL_FROM for it. No server
 * import: client components show the hints.
 *
 * An enhanced code that names the recipient's address comes first, whatever
 * the words around it: Postfix refuses an unknown mailbox on a relay domain
 * with "550 5.1.1 <a@b>: Recipient address rejected: User unknown in relay
 * recipient table", which says "relay" and is still the mailbox.
 */

/**
 * RFC 3463's destination address codes (RFC 7505 adds 5.1.10, null MX): bad mailbox, bad system, bad
 * syntax, ambiguous, moved. Not 5.1.7 or 5.1.8, the sender's address and system (Postfix's "Sender
 * address rejected: Domain not found"), nor 5.1.0, which Postfix gives an unknown sender.
 */
const RECIPIENT_CODE = /\b5\.1\.(?:[1-46]|10)\b/;
/** RFC 3463's 5.7.x: a security or policy refusal, never "no such mailbox". */
const POLICY_CODE = /\b5\.7\.\d{1,3}\b/;
const SENDER_WORDS = /\b(sender|relay(ing)?|authenticat\w*|not owned|not permitted to send|send as)\b/i;
/** An address in the reply ("<sender@guest.vn>") must not count as the wording around it. */
const ADDRESS = /\S+@\S+/g;

export function blamesSender(reply: string): boolean {
  const text = reply.replace(ADDRESS, ' ');
  if (RECIPIENT_CODE.test(text)) return false;
  return POLICY_CODE.test(text) || SENDER_WORDS.test(text);
}
