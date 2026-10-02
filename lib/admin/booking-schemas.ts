import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate } from '@/lib/venue-time';
import { z } from './zod';

/*
 * Input schemas of the booking screens' Server Actions (spec §7.3:
 * Vietnamese messages for every field people type into). Everything arrives
 * as FormData strings; an empty optional field, or one the form did not
 * render, becomes null.
 */

// A field the form did not render has no FormData entry: undefined counts as blank too.
const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);

export const Id = z.string().regex(/^\d{1,18}$/);
export const Version = z.coerce.number().int().min(1);
export const IsoDay = z.string().refine(isValidIsoDate, { error: 'Chọn một ngày hợp lệ.' });
export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Chọn giờ (HH:MM).' });

/** A reason staff write: at most 500 characters (reservation_events.reason); blank = none. */
export const Reason = z.preprocess(blankToNull, z.string().trim().max(500, { error: 'Lý do tối đa 500 ký tự.' }).nullable());

export const TransitionForm = z.object({
  id: Id,
  version: Version,
  to: z.enum(RESERVATION_STATUSES),
  reason: Reason,
});

/** The guest's details as staff type them; the limits are the guest form's (lib/server/booking/input.ts). */
export const GuestFields = {
  guests: z.coerce.number({ error: 'Nhập số khách.' }).int().min(1, { error: 'Ít nhất 1 khách.' }).max(50, { error: 'Tối đa 50 khách.' }),
  name: z.string().trim().min(2, { error: 'Nhập tên khách (ít nhất 2 ký tự).' }).max(120, { error: 'Tên tối đa 120 ký tự.' }),
  phone: z
    .string()
    .trim()
    .min(1, { error: 'Nhập số điện thoại.' })
    .max(40, { error: 'Số điện thoại không hợp lệ.' })
    .refine((v) => toE164(v) !== null, { error: 'Số điện thoại không hợp lệ.' }),
  email: z.preprocess(blankToNull, z.email({ error: 'Email không hợp lệ.' }).max(254).nullable()),
  note: z.preprocess(blankToNull, z.string().trim().max(1000, { error: 'Yêu cầu tối đa 1000 ký tự.' }).nullable()),
  overCapacityReason: Reason,
};

export const EditForm = z.object({ id: Id, version: Version, date: IsoDay, time: Time, ...GuestFields });

export const NoteForm = z.object({
  id: Id,
  body: z.string().trim().min(1, { error: 'Nhập nội dung ghi chú.' }).max(2000, { error: 'Ghi chú tối đa 2000 ký tự.' }),
});
