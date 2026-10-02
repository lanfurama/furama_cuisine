import { EMAIL_EVENTS, STAFF_EMAIL_EVENTS } from '@/lib/email/events';
import { Checkbox, Id, RestaurantId, Token } from './booking-schemas';
import { z } from './zod';

/*
 * Input schemas of the email screens' Server Actions (spec §7.3: Vietnamese
 * messages for the fields people type into). FormData strings; a blank
 * optional field, or one the form did not render, becomes null.
 */
const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);

/** An address staff type: trimmed (z.email alone does not trim), at most 254 characters (RFC 5321), one @. */
export const EmailAddress = z
  .string({ error: 'Nhập email.' })
  .trim()
  .min(1, { error: 'Nhập email.' })
  .max(254, { error: 'Email tối đa 254 ký tự.' })
  .pipe(z.email({ error: 'Email không hợp lệ.' }));

export const LocaleCode = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ.' });

export const RecipientForm = z
  .object({
    scope: z.enum(['all', 'destination', 'restaurant'], { error: 'Chọn phạm vi.' }),
    destinationId: z.preprocess(blankToNull, z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable()),
    restaurantId: z.preprocess(blankToNull, RestaurantId.nullable()),
    email: EmailAddress,
    events: z.array(z.enum(STAFF_EMAIL_EVENTS)).min(1, { error: 'Chọn ít nhất một loại thông báo.' }),
    locale: LocaleCode,
    active: Checkbox,
  })
  .refine((r) => r.scope !== 'restaurant' || r.restaurantId, { error: 'Chọn nhà hàng.', path: ['restaurantId'] })
  .refine((r) => r.scope !== 'destination' || r.destinationId, { error: 'Chọn điểm đến.', path: ['destinationId'] });

/** The row an edit or a delete is about, and the token the page saw. */
export const RecipientTarget = z.object({ id: Id, token: Token });

export const SharedInboxForm = z.object({ email: EmailAddress, token: Token });

export const TestEmailForm = z.object({
  to: EmailAddress,
  event: z.enum(EMAIL_EVENTS, { error: 'Chọn loại email.' }),
  locale: LocaleCode,
});

/** "Gửi lại": the email_outbox row. */
export const RequeueForm = z.object({ id: Id });
