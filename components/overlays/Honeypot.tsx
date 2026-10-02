'use client';

/**
 * The reserve drawer's trap for scripts that fill every field they find
 * (spec §10.2 step 1). People never meet it:
 * - off-screen, not display:none (some scripts skip hidden inputs), and
 *   aria-hidden so screen readers skip it;
 * - out of the tab order (tabIndex -1; axe accepts a focusable element under
 *   aria-hidden only then);
 * - named "website" with autocomplete off and the password managers' opt-out
 *   attributes, so neither browser autofill nor a password manager fills it:
 *   a false positive would refuse a real guest (error.bot_blocked, which at
 *   least gives the phone number, R15).
 * Anything typed here is sent as `honeypot`; the server refuses the request
 * before reading anything else (honeypotFilled).
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="hp" aria-hidden="true">
      <label>
        Website
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
