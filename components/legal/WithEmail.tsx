import { Fragment } from 'react';

/**
 * A policy body whose every {email} becomes a mailto link (phase-5 ledger
 * T8.4: phase 5 linked only the first). An editor may now write the address
 * twice in legal.rights_body; each one links.
 */
export function WithEmail({ template, email }: { template: string; email: string }) {
  const parts = template.split('{email}');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <a href={`mailto:${email}`}>{email}</a> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
