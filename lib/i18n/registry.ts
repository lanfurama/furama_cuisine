/**
 * The list of translatable guest-site strings (spec §5.1 item 2). The code
 * decides which keys exist; the content_strings table only overrides or
 * translates them, and a key with no row falls back to the default here.
 */

/** Admin screens that can edit strings (spec §7.2); a CI test checks every key names one. */
export const ADMIN_SCREENS = [
  'hero',
  'booking',
  'navigation',
  'contact',
  'seo',
  'legal',
  'emails',
  'ui-text',
] as const;
export type AdminScreen = (typeof ADMIN_SCREENS)[number];

export type StringDef = {
  /** English default; always present. */
  en: string;
  /** Vietnamese default; only for email.* and legal.* (spec §5.1). */
  vi?: string;
  /** Longest value an editor may save, counted in characters. */
  maxLength: number;
  /** Placeholder names the value may use, written {name}. */
  vars?: readonly string[];
  /** Where the text appears and what it must keep. Shown to translators and given to the AI. */
  context: string;
  /** The admin screen that edits this key. */
  screen: AdminScreen;
};

// `satisfies` keeps the literal key names, so StringKey is a real union.
export const REGISTRY = {
  'error.restaurant_unavailable': {
    en: 'That restaurant is no longer available.',
    maxLength: 140,
    context: 'Shown under the reservation form when the chosen restaurant stopped taking online bookings.',
    screen: 'ui-text',
  },
  'error.party_too_large': {
    en: 'For more than {max} guests, please call us on {phone}.',
    maxLength: 140,
    vars: ['max', 'phone'],
    context:
      'Party size above the online limit. {max} is the largest party bookable online (booking rules), {phone} the restaurant’s number for larger groups; keep both as is.',
    screen: 'ui-text',
  },
  'error.outside_window': {
    en: 'That date can’t be booked online — please choose one of the dates shown.',
    maxLength: 140,
    context:
      'The date is outside this restaurant’s booking window (staff set it per restaurant, from 1 to 90 days), or is not a real date. Do not name a span of days or weeks: it differs per restaurant.',
    screen: 'ui-text',
  },
  'error.slot_unavailable': {
    en: '{restaurant} does not serve at that time.',
    maxLength: 140,
    vars: ['restaurant'],
    context: 'The time is not in the restaurant’s service hours. {restaurant} is the restaurant name; keep it as is.',
    screen: 'ui-text',
  },
  'error.past': {
    en: 'That time can no longer be booked online — please choose a later time or another day.',
    maxLength: 140,
    context:
      'The chosen sitting is too close to book online (the lead time before it), or online booking for today has closed (the same-day cut-off). Must read right for both.',
    screen: 'ui-text',
  },
  'error.invalid_name': {
    en: 'Please enter your name.',
    maxLength: 140,
    context: 'Name field is empty or invalid.',
    screen: 'ui-text',
  },
  'error.invalid_phone': {
    en: 'Please enter a valid phone number.',
    maxLength: 140,
    context: 'Phone field failed validation.',
    screen: 'ui-text',
  },
  'error.invalid_email': {
    en: 'Please check your email address.',
    maxLength: 140,
    context: 'Email field failed validation.',
    screen: 'ui-text',
  },
  'error.full': {
    en: 'That slot just filled up — please choose another time.',
    maxLength: 140,
    context: 'No covers left at the chosen time.',
    screen: 'ui-text',
  },
  'error.duplicate': {
    en: 'We already have a request for this table under your number.',
    maxLength: 140,
    context: 'The same phone number already has an active request for this restaurant, date and time.',
    screen: 'ui-text',
  },
  'error.closed': {
    en: 'The restaurant is closed at that time — please choose another time or day.',
    maxLength: 140,
    context:
      'A closure, or a day without service, covers the chosen date, or only the chosen meal while another meal that day still takes bookings. Must read right for both.',
    screen: 'ui-text',
  },
  'error.unknown': {
    en: 'Something went wrong with your request. Please try again.',
    maxLength: 140,
    context: 'Any server error not covered by another code.',
    screen: 'ui-text',
  },
  'error.network': {
    en: 'We could not reach the reservations desk. Please try again.',
    maxLength: 140,
    context:
      'The browser could not reach the server, or it could not answer (client side only): on sending the form, and in place of the dates or times when they could not be loaded, above booking.retry.',
    screen: 'ui-text',
  },
  'booking.day_closed': {
    en: 'Closed',
    maxLength: 40,
    context: 'Reservation form, on a date that takes no bookings when the closure has no public reason. Short: it also fits a dropdown note.',
    screen: 'booking',
  },
  'booking.day_full': {
    en: 'Fully booked',
    maxLength: 40,
    context: 'Reservation form, on a date with no tables left at any time. Short: it also fits a dropdown note.',
    screen: 'booking',
  },
  'booking.day_past': {
    en: 'No more tables today',
    maxLength: 40,
    context: 'Reservation form, on today once every sitting has closed to online booking.',
    screen: 'booking',
  },
  'booking.day_note': {
    en: '{date}: {reason}',
    maxLength: 60,
    vars: ['date', 'reason'],
    context:
      'Line under the date strip after a guest taps a date that takes no bookings, and that date’s spoken name. {date} is the formatted date, {reason} the public closure reason or one of booking.day_*; keep both.',
    screen: 'booking',
  },
  'booking.meal_closed': {
    en: 'Not available on this date.',
    maxLength: 80,
    context: 'Under a meal heading (Lunch, Dinner…) when a closure takes out that meal only. The public reason, if any, follows on its own line.',
    screen: 'booking',
  },
  'booking.no_dates': {
    en: 'No dates are open for online booking. Please call us on {phone}.',
    maxLength: 140,
    vars: ['phone'],
    context: 'Reservation form, when no date in the booking window takes bookings. {phone} is the restaurant’s number; keep it.',
    screen: 'booking',
  },
  'booking.day_outside': {
    en: 'Not open for booking yet',
    maxLength: 40,
    context:
      'Reservation form: why a date cannot be booked when it lies beyond this restaurant’s booking window (staff set it per restaurant). Used as {reason} in booking.date_moved. Short.',
    screen: 'booking',
  },
  'booking.date_moved': {
    en: '{date} can’t be booked ({reason}). Your table is now set for {to}.',
    maxLength: 160,
    vars: ['date', 'reason', 'to'],
    context:
      'Line under the date strip when the form had to move the chosen date: another restaurant was chosen (or fresh availability arrived) and it does not take that date, so the nearest open day was chosen instead. {date} is the date given up, {reason} the public closure reason or one of booking.day_* (booking.day_outside beyond the window), {to} the new date; keep all three.',
    screen: 'booking',
  },
  'booking.loading': {
    en: 'Checking tables…',
    maxLength: 40,
    context:
      'Reservation form, while availability loads: under DATE before the first dates arrive, in place of the time slots, and beside REQUEST BOOKING when it is pressed before the dates have arrived.',
    screen: 'booking',
  },
  'booking.done_requested': {
    en: 'Your table request at {restaurant} has been received. Our team will contact you shortly to confirm.',
    maxLength: 200,
    vars: ['restaurant'],
    context:
      'Thank-you screen of the reservation form when the booking waits for staff to confirm it (status requested). {restaurant} is the restaurant name; keep it. Must say the same as the guest.ack email (phase 5).',
    screen: 'booking',
  },
  'booking.done_confirmed': {
    en: 'Your table at {restaurant} is confirmed. We look forward to welcoming you.',
    maxLength: 200,
    vars: ['restaurant'],
    context:
      'Thank-you screen of the reservation form when the restaurant confirms online bookings at once (auto-confirm; status confirmed): nobody will call to confirm. {restaurant} is the restaurant name; keep it. Must say the same as the guest.confirmed email (phase 5).',
    screen: 'booking',
  },
  'booking.retry': {
    en: 'Try again',
    maxLength: 30,
    context:
      'Reservation form, a button under error.network when the dates or the times could not be loaded (server error or no connection); it asks the server again.',
    screen: 'booking',
  },
  // ── The privacy notice and consent (spec §11, Law 91/2025/QH15). English only until a reviewed ──
  // Vietnamese text exists (R17); lib/legal.test.ts pins a hash of these texts to PRIVACY_POLICY_VERSION.
  // booking.* so they reach the reservation form; legal.link reaches the browser too (form and footer).
  'booking.privacy_notice': {
    en: 'We use your name, phone number and email only to arrange this booking and to contact you about it.',
    maxLength: 240,
    context:
      'Reservation form, above the consent checkbox: the short privacy notice at the point of collection (spec §11, Law 91/2025/QH15). Must stay true to legal.* on the policy page.',
    screen: 'legal',
  },
  'booking.consent': {
    en: 'I agree to Furama Cuisine using my details as described in the privacy policy.',
    maxLength: 160,
    context:
      'Reservation form, the label of the required consent checkbox. The policy link sits next to it (legal.link), not inside the label.',
    screen: 'legal',
  },
  'legal.link': {
    en: 'Privacy policy',
    maxLength: 40,
    context: 'Link to the privacy policy page, in the reservation form next to the consent box and in the site footer.',
    screen: 'legal',
  },
  'legal.title': {
    en: 'Privacy policy',
    maxLength: 60,
    context: 'Privacy policy page: the heading and the browser tab title.',
    screen: 'legal',
  },
  'legal.updated': {
    en: 'Last updated {date}',
    maxLength: 60,
    vars: ['date'],
    context: 'Privacy policy page, under the heading. {date} is the policy version’s date, formatted; keep it.',
    screen: 'legal',
  },
  'legal.intro': {
    en: 'Furama Cuisine is the dining brand of Furama Resort Danang and Furama Dining House. This policy explains what we do with the details you give us when you request a table online.',
    maxLength: 600,
    context: 'Privacy policy page, the opening paragraph: who is responsible for the data.',
    screen: 'legal',
  },
  'legal.collect_heading': {
    en: 'What we collect',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
  },
  'legal.collect_body': {
    en: 'Your name and phone number; your email address and any special request, if you give them; the restaurant, date, time and party size you chose; and the time you sent the request and agreed to this policy.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “What we collect”. Must match the fields of the reservation form.',
    screen: 'legal',
  },
  'legal.use_heading': {
    en: 'How we use it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
  },
  'legal.use_body': {
    en: 'Only to arrange your booking: to hold your table, to confirm, change or cancel it with you by phone or email, and to welcome you on the day. We do not use your details for marketing and we do not sell them.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “How we use it”.',
    screen: 'legal',
  },
  'legal.share_heading': {
    en: 'Who sees it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
  },
  'legal.share_body': {
    en: 'Our reservations staff. The companies that host this website and its database and send our emails process your details on our behalf and only on our instructions.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “Who sees it”: staff and processors (hosting, database, email).',
    screen: 'legal',
  },
  'legal.keep_heading': {
    en: 'How long we keep it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
  },
  'legal.keep_body': {
    en: 'We keep your contact details for up to 24 months after the date of your booking, then remove them. We keep only the date, time, party size and restaurant, without your name or contact details, for our statistics.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “How long we keep it”. The months must match the retention setting (booking_settings.pii_retention_months).',
    screen: 'legal',
  },
  'legal.rights_heading': {
    en: 'Your rights',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
  },
  'legal.rights_body': {
    en: 'You may ask to see, correct or delete your details, or withdraw your consent, at any time. Write to {email} or call the restaurant. Withdrawing consent does not affect a booking already handled.',
    maxLength: 1200,
    vars: ['email'],
    context: 'Privacy policy page, the body of “Your rights”. {email} is the contact address, shown as a link; keep it.',
    screen: 'legal',
  },
  // ── Booking emails (spec §10.4): email.<event>.<field>, shared labels under email.common. ──
  // Rendered in the reservation's language for guests and the recipient's for staff
  // (lib/server/email/booking/render.ts). Phase 7 edits them in /admin/content/emails.
  'email.common.label_reference': {
    en: 'Reference',
    vi: 'Mã đặt bàn',
    maxLength: 40,
    context: 'Booking emails, label of the booking reference (FC-7K3QH9XA) in the details table.',
    screen: 'emails',
  },
  'email.common.label_restaurant': {
    en: 'Restaurant',
    vi: 'Nhà hàng',
    maxLength: 40,
    context: 'Booking emails, label of the restaurant name in the details table.',
    screen: 'emails',
  },
  'email.common.label_date': {
    en: 'Date',
    vi: 'Ngày',
    maxLength: 40,
    context: 'Booking emails, label of the date in the details table (the date itself is formatted for the language).',
    screen: 'emails',
  },
  'email.common.label_time': {
    en: 'Time',
    vi: 'Giờ',
    maxLength: 40,
    context: 'Booking emails, label of the time in the details table.',
    screen: 'emails',
  },
  'email.common.time_value': {
    en: '{time} (Da Nang time, GMT+7)',
    vi: '{time} (giờ Đà Nẵng, GMT+7)',
    maxLength: 60,
    vars: ['time'],
    context: 'Booking emails, the time of the sitting. {time} is formatted for the language (7:00 PM, 19:00); keep it. Guests may read the email in another timezone.',
    screen: 'emails',
  },
  'email.common.label_guests': {
    en: 'Guests',
    vi: 'Số khách',
    maxLength: 40,
    context: 'Booking emails, label of the party size in the details table (a number follows).',
    screen: 'emails',
  },
  'email.common.label_reason': {
    en: 'Reason',
    vi: 'Lý do',
    maxLength: 40,
    context: 'Decline and cancellation emails, label of the reason staff gave (their text follows as typed).',
    screen: 'emails',
  },
  'email.common.contact': {
    en: 'Questions or changes? Please call us on {phone}.',
    vi: 'Cần hỏi thêm hoặc thay đổi? Vui lòng gọi cho chúng tôi theo số {phone}.',
    maxLength: 160,
    vars: ['phone'],
    context: 'Guest booking emails, under the details. {phone} is the restaurant’s (its destination’s) number; keep it.',
    screen: 'emails',
  },
  'email.common.footer_guest': {
    en: 'You are receiving this email because a table was booked with this address at Furama Cuisine.',
    vi: 'Bạn nhận được email này vì có một đặt bàn tại Furama Cuisine dùng địa chỉ email này.',
    maxLength: 200,
    context: 'Guest booking emails, small print at the bottom.',
    screen: 'emails',
  },
  'email.common.footer_staff': {
    en: 'Automatic notification from the Furama Cuisine booking system.',
    vi: 'Thông báo tự động từ hệ thống đặt bàn Furama Cuisine.',
    maxLength: 200,
    context: 'Staff notification emails, small print at the bottom.',
    screen: 'emails',
  },
  'email.guest.ack.subject': {
    en: 'We have received your table request ({reference})',
    vi: 'Chúng tôi đã nhận yêu cầu đặt bàn của bạn ({reference})',
    maxLength: 120,
    vars: ['reference'],
    context: 'Subject of the email a guest gets right after booking online, while the request waits for staff. {reference} is the booking reference; keep it.',
    screen: 'emails',
  },
  'email.guest.ack.heading': {
    en: 'Request received',
    vi: 'Đã nhận yêu cầu đặt bàn',
    maxLength: 80,
    context: 'Heading of the "request received" email.',
    screen: 'emails',
  },
  'email.guest.ack.intro': {
    en: 'Your table request at {restaurant} has been received. Our team will contact you shortly to confirm.',
    vi: 'Yêu cầu đặt bàn của bạn tại {restaurant} đã được tiếp nhận. Đội ngũ của chúng tôi sẽ sớm liên hệ để xác nhận.',
    maxLength: 300,
    vars: ['restaurant'],
    context:
      'First paragraph of the "request received" email. Must say the same as the reservation form’s done screen for a request (booking.done_requested). {restaurant} is the restaurant name; keep it.',
    screen: 'emails',
  },
  'email.guest.confirmed.subject': {
    en: 'Your table is confirmed ({reference})',
    vi: 'Đặt bàn của bạn đã được xác nhận ({reference})',
    maxLength: 120,
    vars: ['reference'],
    context: 'Subject of the email a guest gets when the booking is confirmed (by staff, automatically, or a phone booking). {reference}: keep it.',
    screen: 'emails',
  },
  'email.guest.confirmed.heading': {
    en: 'Table confirmed',
    vi: 'Đã xác nhận đặt bàn',
    maxLength: 80,
    context: 'Heading of the confirmation email.',
    screen: 'emails',
  },
  'email.guest.confirmed.intro': {
    en: 'Your table at {restaurant} is confirmed. We look forward to welcoming you.',
    vi: 'Bàn của bạn tại {restaurant} đã được xác nhận. Chúng tôi rất mong được đón tiếp bạn.',
    maxLength: 300,
    vars: ['restaurant'],
    context:
      'First paragraph of the confirmation email. Must say the same as the reservation form’s done screen for a confirmed booking (booking.done_confirmed). {restaurant}: keep it.',
    screen: 'emails',
  },
  'email.guest.declined.subject': {
    en: 'We could not confirm your table request ({reference})',
    vi: 'Chúng tôi chưa thể nhận yêu cầu đặt bàn của bạn ({reference})',
    maxLength: 120,
    vars: ['reference'],
    context: 'Subject of the email a guest gets when staff decline the request. {reference}: keep it.',
    screen: 'emails',
  },
  'email.guest.declined.heading': {
    en: 'Request not confirmed',
    vi: 'Yêu cầu chưa được xác nhận',
    maxLength: 80,
    context: 'Heading of the decline email.',
    screen: 'emails',
  },
  'email.guest.declined.intro': {
    en: 'We are sorry, but we cannot confirm your table request at {restaurant}.',
    vi: 'Rất tiếc, chúng tôi không thể xác nhận yêu cầu đặt bàn của bạn tại {restaurant}.',
    maxLength: 300,
    vars: ['restaurant'],
    context: 'First paragraph of the decline email; the reason staff gave follows. {restaurant}: keep it.',
    screen: 'emails',
  },
  'email.guest.cancelled.subject': {
    en: 'Your reservation has been cancelled ({reference})',
    vi: 'Đặt bàn của bạn đã được hủy ({reference})',
    maxLength: 120,
    vars: ['reference'],
    context: 'Subject of the email a guest gets when staff cancel the booking and tick "notify the guest". {reference}: keep it.',
    screen: 'emails',
  },
  'email.guest.cancelled.heading': {
    en: 'Reservation cancelled',
    vi: 'Đặt bàn đã được hủy',
    maxLength: 80,
    context: 'Heading of the cancellation email.',
    screen: 'emails',
  },
  'email.guest.cancelled.intro': {
    en: 'Your reservation at {restaurant} has been cancelled.',
    vi: 'Đặt bàn của bạn tại {restaurant} đã được hủy.',
    maxLength: 300,
    vars: ['restaurant'],
    context: 'First paragraph of the cancellation email; the reason staff gave follows. {restaurant}: keep it.',
    screen: 'emails',
  },
  'email.staff.new.subject': {
    en: 'New booking {reference}: {restaurant}, {date} {time}, party of {guests}',
    vi: 'Đặt bàn mới {reference}: {restaurant}, {date} {time}, {guests} khách',
    maxLength: 160,
    vars: ['reference', 'restaurant', 'date', 'time', 'guests'],
    context: 'Subject of the staff notification for a new online booking. Keep every placeholder; {date} is short (Mon, 5 Oct 2026), {guests} a number.',
    screen: 'emails',
  },
  'email.staff.new.heading': {
    en: 'New online booking',
    vi: 'Có đặt bàn online mới',
    maxLength: 80,
    context: 'Heading of the staff notification for a new online booking.',
    screen: 'emails',
  },
  'email.staff.new.intro_requested': {
    en: 'A guest has requested a table. Please confirm or decline it in the admin.',
    vi: 'Khách vừa gửi yêu cầu đặt bàn. Vui lòng xác nhận hoặc từ chối trong trang quản trị.',
    maxLength: 300,
    context: 'Staff notification, when the booking waits for staff (auto-confirm off).',
    screen: 'emails',
  },
  'email.staff.new.intro_confirmed': {
    en: 'A guest has booked a table. It was confirmed automatically.',
    vi: 'Khách vừa đặt bàn. Đặt bàn đã được tự động xác nhận.',
    maxLength: 300,
    context: 'Staff notification, when auto-confirm already confirmed the booking.',
    screen: 'emails',
  },
  'email.staff.new.label_guest': {
    en: 'Guest',
    vi: 'Khách',
    maxLength: 40,
    context: 'Staff notification, label of the guest’s name.',
    screen: 'emails',
  },
  'email.staff.new.label_phone': {
    en: 'Phone',
    vi: 'Điện thoại',
    maxLength: 40,
    context: 'Staff notification, label of the guest’s phone number.',
    screen: 'emails',
  },
  'email.staff.new.label_email': {
    en: 'Email',
    vi: 'Email',
    maxLength: 40,
    context: 'Staff notification, label of the guest’s email address.',
    screen: 'emails',
  },
  'email.staff.new.label_note': {
    en: 'Guest’s request',
    vi: 'Yêu cầu của khách',
    maxLength: 40,
    context: 'Staff notification, label of the note the guest typed in the form (never staff notes).',
    screen: 'emails',
  },
  'email.staff.new.button': {
    en: 'Open the booking',
    vi: 'Mở đặt bàn',
    maxLength: 40,
    context: 'Staff notification, button linking to the booking in the admin.',
    screen: 'emails',
  },
} as const satisfies Record<string, StringDef>;

export type StringKey = keyof typeof REGISTRY;

export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];

/** Same pattern as the CHECK on content_strings.key (migration 004). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Keys the browser needs: the reservation form's copy and its error messages, and the policy link (form and footer). */
export type ClientKey = Extract<StringKey, `error.${string}` | `booking.${string}` | 'legal.link'>;

/** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
export const CLIENT_KEYS = STRING_KEYS.filter(
  (k): k is ClientKey => k.startsWith('error.') || k.startsWith('booking.') || k === 'legal.link',
);

/** The registry's own text for a language other than English; only `vi`, and only where declared. */
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
