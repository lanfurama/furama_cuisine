'use client';

import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { resendInvite, revokeInvite } from './actions';

/* Labels arrive formatted from the server, so no permission code ships to the browser. */
export type InvitationItem = { id: string; email: string; roleLabel: string; expiresLabel: string; expired: boolean; emailFailed: boolean };

export function InvitationList({ invitations }: { invitations: InvitationItem[] }) {
  if (invitations.length === 0) return <p className="a-lede">Không có lời mời nào đang chờ.</p>;
  return (
    <ul className="a-list" aria-label="Lời mời đang chờ">
      {invitations.map((invitation) => (
        <Invitation key={invitation.id} invitation={invitation} />
      ))}
    </ul>
  );
}

function Invitation({ invitation }: { invitation: InvitationItem }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const resend = () =>
    startTransition(async () => {
      const result = await resendInvite(invitation.id);
      if (!result.ok) setMessage({ text: actionErrorMessage(result.code), error: true });
      else setMessage({ text: result.data.emailSent ? 'Đã gửi lại.' : 'Chưa gửi được email, bấm Gửi lại.', error: !result.data.emailSent });
    });
  const revoke = () =>
    startTransition(async () => {
      const result = await revokeInvite(invitation.id);
      // On success the refreshed list no longer has this row.
      if (!result.ok) setMessage({ text: actionErrorMessage(result.code), error: true });
    });

  return (
    <li className="a-list-item" data-email={invitation.email}>
      <div>
        <strong>{invitation.email}</strong> · {invitation.roleLabel} ·{' '}
        {invitation.expired ? 'đã hết hạn' : `hết hạn ${invitation.expiresLabel}`}
        {invitation.emailFailed && !message ? (
          <p className="a-field-error" role="alert">
            Chưa gửi được email, bấm Gửi lại.
          </p>
        ) : null}
        {message ? (
          <p className={message.error ? 'a-field-error' : 'a-notice'} role={message.error ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="a-actions">
        <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={resend}>
          Gửi lại
        </button>
        <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={revoke}>
          Thu hồi
        </button>
      </div>
    </li>
  );
}
