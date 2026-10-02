import { DEFAULT_PHONE, bookingErrorParams, type BookingErrorCode, type ErrorKey } from '@/lib/booking-errors';
import type { GroupPhone } from '@/lib/booking/rules';
import { formatMessage, type MessageParams } from '@/lib/i18n/format';

/** A message with {phone} turned into a tel: link (any other placeholder is filled as text). */
export function WithPhone({ template, params, phone }: { template: string; params: MessageParams; phone: GroupPhone }) {
  const parts = template.split('{phone}');
  if (parts.length < 2 || !phone.tel) return <>{formatMessage(template, { ...params, phone: phone.display })}</>;
  return (
    <>
      {formatMessage(parts[0], params)}
      <a href={`tel:${phone.tel}`}>{phone.display}</a>
      {formatMessage(parts.slice(1).join(phone.display), params)}
    </>
  );
}

/**
 * A booking failure (error.<code>) as the guest reads it: every one that names
 * a number (spec §12) makes it a link, so calling is one tap. `phone` is the
 * chosen restaurant's number; until its availability has arrived, the
 * resort's (DEFAULT_PHONE).
 */
export function BookingError({
  code,
  params,
  strings,
  phone,
}: {
  code: BookingErrorCode;
  params?: Record<string, string>;
  strings: Record<ErrorKey, string>;
  phone: GroupPhone | null;
}) {
  return <WithPhone template={strings[`error.${code}`]} params={bookingErrorParams(params)} phone={phone ?? DEFAULT_PHONE} />;
}
