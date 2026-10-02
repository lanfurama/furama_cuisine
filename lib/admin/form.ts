import { startTransition, type FormEvent } from 'react';

/*
 * `<form action={dispatch}>` resets every uncontrolled field once the action
 * settles, whatever it returned, so a refused form loses what staff typed
 * (phase-3 ledger, phase 7 "echo submitted values back on failure"). Long
 * forms submit through this instead: the same useActionState dispatcher (so
 * `pending` and the returned state work as usual), the same FormData (with
 * the clicked button's name and value), and no reset. Client components only.
 * Give the form method="post": submitted before hydration, a form with no
 * method is a GET that puts every field in the URL (and the server's logs).
 */
export function submitKeepingValues(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => dispatch(formData));
  };
}
