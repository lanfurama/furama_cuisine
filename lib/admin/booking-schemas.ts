import { RESERVATION_STATUSES, SLOT_INTERVALS } from '@/lib/booking/rules';
import { MEALS } from '@/lib/data';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, toMinutes } from '@/lib/venue-time';
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
export const RestaurantId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
/** A concurrency token: updated_at in microseconds since the epoch, as the page saw it. */
export const Token = z.string().regex(/^\d{1,17}$/);
export const Meal = z.enum(MEALS as [string, ...string[]]);
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

/** A phone booking (confirmed) or a walk-in (seated) made by staff; the action checks the language exists. */
export const NewReservationForm = z.object({
  restaurant: RestaurantId,
  date: IsoDay,
  time: Time,
  source: z.enum(['phone', 'walk_in'], { error: 'Chọn nguồn đặt bàn.' }),
  locale: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ của khách.' }),
  ...GuestFields,
});

/** "id:version" pairs ticked in an affected list, and why they are cancelled. */
export const CancelManyForm = z.object({
  items: z
    .array(z.string().regex(/^\d{1,18}:\d{1,9}$/))
    .min(1, { error: 'Chọn ít nhất một đặt bàn.' })
    .max(200),
  reason: z.string().trim().min(1, { error: 'Nhập lý do hủy.' }).max(500, { error: 'Lý do tối đa 500 ký tự.' }),
});

/** A per-restaurant override: blank follows "Cài đặt đặt bàn"; the bounds are migration 006's. */
const override = (min: number, max: number, label: string) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: `${label}: nhập số.` })
      .int({ error: `${label}: nhập số nguyên.` })
      .min(min, { error: `${label}: từ ${min} đến ${max}.` })
      .max(max, { error: `${label}: từ ${min} đến ${max}.` })
      .nullable(),
  );

export const RulesForm = z.object({
  restaurant: RestaurantId,
  token: Token,
  bookingEnabled: z.preprocess((v) => v === 'on', z.boolean()),
  windowDays: override(1, 90, 'Số ngày đặt trước'),
  leadMinutes: override(0, 1440, 'Đặt trước tối thiểu (phút)'),
  maxParty: override(1, 50, 'Số khách tối đa'),
});

export const PeriodForm = z
  .object({
    id: z.preprocess(blankToNull, Id.nullable()),
    meal: Meal,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, { error: 'Chọn ít nhất một ngày trong tuần.' }).max(7),
    firstSeating: Time,
    lastSeating: Time,
    intervalMin: z.number().refine((n) => (SLOT_INTERVALS as readonly number[]).includes(n), { error: 'Chọn khoảng cách giữa các giờ.' }),
    coversPerSlot: z.number().int().min(0, { error: 'Sức chứa không âm.' }).max(1000, { error: 'Sức chứa tối đa 1000.' }),
    active: z.boolean(),
  })
  .refine((p) => p.lastSeating >= p.firstSeating, { error: 'Giờ nhận khách cuối phải từ giờ đầu trở đi.', path: ['lastSeating'] })
  // Without this the database's CHECK service_periods_grid would refuse the save as a db_error.
  .refine(
    (p) =>
      p.lastSeating < p.firstSeating ||
      !(SLOT_INTERVALS as readonly number[]).includes(p.intervalMin) ||
      (toMinutes(p.lastSeating) - toMinutes(p.firstSeating)) % p.intervalMin === 0,
    { error: 'Giờ cuối phải cách giờ đầu một số lần đúng bằng khoảng cách (ví dụ 18:00 → 21:00 với 30 phút).', path: ['lastSeating'] },
  );

/** The periods editor posts its whole list as one JSON field. At most 20 periods a restaurant. */
export const PeriodsForm = z.object({
  restaurant: RestaurantId,
  token: Token,
  periods: z.preprocess((v) => {
    try {
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch {
      return null;
    }
  }, z.array(PeriodForm).max(20, { error: 'Tối đa 20 ca phục vụ.' })),
});

/** auto_confirm per restaurant (Admin): follow "Cài đặt đặt bàn" (null), on or off. */
export const AutoConfirmForm = z.object({
  restaurant: RestaurantId,
  token: Token,
  autoConfirm: z.enum(['inherit', 'on', 'off']).transform((v) => (v === 'inherit' ? null : v === 'on')),
});

const bounded = (min: number, max: number, message: string) => z.coerce.number({ error: message }).int({ error: message }).min(min, { error: message }).max(max, { error: message });

/** "Cài đặt đặt bàn" (Admin): the defaults every restaurant inherits; the bounds are migration 006's. */
export const SettingsForm = z.object({
  token: Token,
  windowDays: bounded(1, 90, 'Từ 1 đến 90 ngày.'),
  leadMinutes: bounded(0, 1440, 'Từ 0 đến 1440 phút.'),
  sameDayCutoff: z.preprocess(blankToNull, Time.nullable()),
  maxParty: bounded(1, 50, 'Từ 1 đến 50 khách.'),
  autoConfirm: z.preprocess((v) => v === 'on', z.boolean()),
  guestAckEmail: z.preprocess((v) => v === 'on', z.boolean()),
  piiRetentionMonths: bounded(1, 120, 'Từ 1 đến 120 tháng.'),
});

/** A closure (spec §10.1): no meal ticked closes the whole day; the guest-facing reasons go to closure_i18n. */
export const ClosureForm = z
  .object({
    scope: z.enum(['all', 'destination', 'restaurant'], { error: 'Chọn phạm vi.' }),
    destinationId: z.preprocess(blankToNull, z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable()),
    restaurantId: z.preprocess(blankToNull, RestaurantId.nullable()),
    startsOn: IsoDay,
    endsOn: IsoDay,
    meals: z.array(Meal).max(4),
    showReason: z.preprocess((v) => v === 'on', z.boolean()),
    reasonEn: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
    reasonVi: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
    internalNote: z.preprocess(blankToNull, z.string().trim().max(2000, { error: 'Tối đa 2000 ký tự.' }).nullable()),
  })
  .refine((c) => c.endsOn >= c.startsOn, { error: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.', path: ['endsOn'] })
  .refine((c) => c.scope !== 'restaurant' || c.restaurantId, { error: 'Chọn nhà hàng.', path: ['restaurantId'] })
  .refine((c) => c.scope !== 'destination' || c.destinationId, { error: 'Chọn điểm đến.', path: ['destinationId'] });
