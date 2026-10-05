/**
 * The list of translatable guest-site strings (spec §5.1 item 2). The code
 * decides which keys exist; the content_strings table only overrides or
 * translates them, and a key with no row falls back to the default here.
 */

/**
 * The admin screens that edit strings (spec §7.2: /admin/content/<screen>,
 * and /admin/restaurants for the "Our Restaurants" copy and the detail
 * page's shared labels). Every key names one (`screen`); lib/admin/content-screens.ts
 * maps each to its route, and test/guards/editing-screens.guard.test.ts
 * checks the route exists and renders that screen's keys.
 */
export const ADMIN_SCREENS = [
  'hero',
  'cuisines',
  'restaurants',
  'destinations',
  'experiences',
  'heritage',
  'stories',
  'offers',
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
  /**
   * The field's name in the admin, in Vietnamese (spec §7.3: the admin speaks
   * Vietnamese; `context` is for translators and the AI). PHASE 7: required on
   * every key once the editors cover them; until then the key shows.
   */
  label?: string;
};

// `satisfies` keeps the literal key names, so StringKey is a real union.
export const REGISTRY = {
  'error.restaurant_unavailable': {
    en: 'This restaurant is not taking online bookings right now. Please call us on {phone}.',
    maxLength: 140,
    vars: ['phone'],
    context:
      'Reservation form and booking bar, when the chosen restaurant does not take online bookings at the moment (staff switched it off); there is no Try again. Must not suggest the restaurant has closed. {phone} is the restaurant’s number, shown as a link to call; keep it.',
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
  'error.consent_required': {
    en: 'Please tick the box to agree to how we use your details.',
    maxLength: 140,
    context:
      'Under the consent checkbox of the reservation form, when the guest sends the request without ticking it (spec §11). Names the box, not the law.',
    screen: 'ui-text',
  },
  'error.too_many_requests': {
    en: 'This number already has {limit} table requests for that day. To book more, please call us on {phone}.',
    maxLength: 160,
    vars: ['limit', 'phone'],
    context:
      'One phone number already holds the most active online requests allowed for that date, across all restaurants (spec §10.2 step 5). {limit} is that number, {phone} the restaurant’s number; keep both.',
    screen: 'ui-text',
  },
  'error.bot_blocked': {
    en: 'We could not accept this request online. Please call us on {phone} to book.',
    maxLength: 140,
    vars: ['phone'],
    context:
      'The request looked automated (bot protection) and was refused. A real guest may see it: never accuse, always give the phone. {phone} is the restaurant’s number; keep it.',
    screen: 'ui-text',
  },
  'error.unknown': {
    en: 'Something went wrong with your request. Please try again.',
    maxLength: 140,
    context: 'Any server error not covered by another code.',
    screen: 'ui-text',
  },
  'error.network': {
    en: 'We could not reach the reservations desk. Please try again, or call us on {phone}.',
    maxLength: 140,
    vars: ['phone'],
    context:
      'The browser could not reach the server, or it could not answer (client side only): on sending the form (also when the bot check could not run), and in place of the dates or times when they could not be loaded, above Try again (booking.retry). {phone} is the restaurant’s number, shown as a link to call (spec §12); keep it.',
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
  'booking.no_tables': {
    en: 'No tables left on this date — please choose another day.',
    maxLength: 120,
    context:
      'Reservation form, under TIME, when every time of the chosen date is taken for this party size (the slots show struck through). Read out by screen readers when it appears.',
    screen: 'booking',
  },
  'booking.no_dates': {
    en: 'No dates are open for online booking. Please call us on {phone}.',
    maxLength: 140,
    vars: ['phone'],
    context: 'Reservation form, when no date in the booking window takes bookings. {phone} is the restaurant’s number; keep it.',
    screen: 'booking',
  },
  // ── "Gọi để đặt bàn" (R20, phase 6): when online booking is off, the number to call instead. ──
  'booking.all_offline': {
    en: 'Online booking is not available right now. Please call us on {phone} to book a table.',
    maxLength: 140,
    vars: ['phone'],
    context:
      'Reservation form, in place of the whole form when staff have switched online booking off for every restaurant. {phone} is the resort’s number, shown as a link to call; keep it.',
    screen: 'booking',
  },
  'booking.call_tag': {
    en: 'Call {phone}',
    maxLength: 40,
    vars: ['phone'],
    context:
      'Restaurant card on the home page, the tag shown on hover (in capitals by CSS; "→" follows), for a restaurant with no page of its own whose online booking staff have switched off: a tap calls it. {phone} is the restaurant’s number, else its destination’s, as printed; keep it.',
    screen: 'booking',
  },
  'booking.call_action': {
    en: 'Call',
    maxLength: 20,
    context:
      'Search results, the action at the end of a row ("→" follows), for a restaurant with no page of its own whose online booking staff have switched off: a tap calls it. Short: the row is narrow on a phone.',
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
    en: 'We use your name, phone number and email to arrange this booking and to contact you about it. To stop abuse, we also check how many online requests your phone number has made for the same day, and run an automated bot check.',
    maxLength: 240,
    context:
      'Reservation form, above the consent checkbox: the short privacy notice at the point of collection (spec §11, Law 91/2025/QH15). Must stay true to legal.* on the policy page, the anti-abuse checks included (the per-phone daily limit and the bot check).',
    screen: 'legal',
    label: 'Thông báo bảo mật trong form đặt bàn',
  },
  'booking.consent': {
    en: 'I agree to Furama Cuisine using my details as described in the privacy policy.',
    maxLength: 160,
    context:
      'Reservation form, the label of the required consent checkbox. The policy link sits next to it (legal.link), not inside the label.',
    screen: 'legal',
    label: 'Câu đồng ý (ô tick) trong form đặt bàn',
  },
  'legal.link': {
    en: 'Privacy policy',
    maxLength: 40,
    context: 'Link to the privacy policy page, in the reservation form next to the consent box and in the site footer.',
    screen: 'legal',
    label: 'Chữ của link tới trang chính sách',
  },
  'legal.title': {
    en: 'Privacy policy',
    maxLength: 60,
    context: 'Privacy policy page: the heading and the browser tab title.',
    screen: 'legal',
    label: 'Tiêu đề trang',
  },
  'legal.updated': {
    en: 'Last updated {date}',
    maxLength: 60,
    vars: ['date'],
    context: 'Privacy policy page, under the heading. {date} is the policy version’s date, formatted; keep it.',
    screen: 'legal',
    label: 'Dòng “cập nhật ngày”',
  },
  'legal.intro': {
    en: 'Furama Cuisine is the dining brand of Furama Resort Danang and Furama Dining House. This policy explains what we do with the details you give us when you request a table online.',
    maxLength: 600,
    context: 'Privacy policy page, the opening paragraph: who is responsible for the data.',
    screen: 'legal',
    label: 'Đoạn mở đầu',
  },
  'legal.collect_heading': {
    en: 'What we collect',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
    label: 'Mục 1: tiêu đề',
  },
  'legal.collect_body': {
    en: 'Your name and phone number; your email address and any special request, if you give them; the restaurant, date, time and party size you chose; the time you sent the request and agreed to this policy; and technical signals your browser sends, used only for the bot check.',
    maxLength: 1200,
    context:
      'Privacy policy page, the body of “What we collect”. Must match the fields of the reservation form, and the signals the bot check reads in the browser (Vercel BotID).',
    screen: 'legal',
    label: 'Mục 1: nội dung',
  },
  'legal.use_heading': {
    en: 'How we use it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
    label: 'Mục 2: tiêu đề',
  },
  'legal.use_body': {
    en: 'To arrange your booking: to hold your table, to confirm, change or cancel it with you by phone or email, and to welcome you on the day. To protect online booking from abuse: we count the online requests made with one phone number for the same day, and the website runs an automated check, provided by our hosting company, that tells people from bots. We do not use your details for marketing and we do not sell them.',
    maxLength: 1200,
    context:
      'Privacy policy page, the body of “How we use it”: the booking, and the two anti-abuse checks (the per-phone daily limit, spec §10.2 step 5; the bot check, step 1). Keep the no-marketing sentence.',
    screen: 'legal',
    label: 'Mục 2: nội dung',
  },
  'legal.share_heading': {
    en: 'Who sees it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
    label: 'Mục 3: tiêu đề',
  },
  'legal.share_body': {
    en: 'Our reservations staff. The companies that host this website and its database, protect it against automated requests, and send our emails process your details on our behalf and only on our instructions.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “Who sees it”: staff and processors (hosting, database, bot protection, email).',
    screen: 'legal',
    label: 'Mục 3: nội dung',
  },
  'legal.keep_heading': {
    en: 'How long we keep it',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
    label: 'Mục 4: tiêu đề',
  },
  'legal.keep_body': {
    en: 'We keep your contact details for up to 24 months after the date of your booking, then remove them. We keep only the date, time, party size and restaurant, without your name or contact details, for our statistics.',
    maxLength: 1200,
    context: 'Privacy policy page, the body of “How long we keep it”. The months must match the retention setting (booking_settings.pii_retention_months).',
    screen: 'legal',
    label: 'Mục 4: nội dung',
  },
  'legal.rights_heading': {
    en: 'Your rights',
    maxLength: 80,
    context: 'Privacy policy page, a section heading.',
    screen: 'legal',
    label: 'Mục 5: tiêu đề',
  },
  'legal.rights_body': {
    en: 'You may ask to see, correct or delete your details, or withdraw your consent, at any time. Write to {email} or call the restaurant. Withdrawing consent does not affect a booking already handled.',
    maxLength: 1200,
    vars: ['email'],
    context: 'Privacy policy page, the body of “Your rights”. {email} is the contact address, shown as a link; keep it.',
    screen: 'legal',
    label: 'Mục 5: nội dung',
  },
  // ── Booking emails (spec §10.4): email.<event>.<field>, shared labels under email.common. ──
  // Rendered in the reservation's language for guests and the recipient's for staff
  // (lib/server/email/booking/render.ts). Phase 7 edits them in /admin/content/emails.
  // ── Home sections: read by the home page on the server, handed to each section (pageKeys) ──
  'stories.title': {
    en: 'Stories from our Kitchens',
    maxLength: 40,
    context: 'Home page, title of the Stories section (links to articles about the kitchens). Two short lines at most on a phone.',
    screen: 'stories',
    label: 'Tiêu đề mục Stories',
  },
  'stories.lede': {
    en: 'Chefs, ingredients and the cultures behind every plate.',
    maxLength: 120,
    context: 'Home page, one sentence under the Stories title.',
    screen: 'stories',
    label: 'Câu dẫn mục Stories',
  },
  'heritage.kicker': {
    en: 'Since 1997 · Furama Resort Danang',
    maxLength: 48,
    context: 'Home page, small line above the Heritage title, on a photo. One line on a phone.',
    screen: 'heritage',
    label: 'Dòng nhỏ phía trên tiêu đề',
  },
  'heritage.title_1': {
    en: 'A culinary heritage',
    maxLength: 28,
    context: 'Home page, Heritage title, first of two lines (the box has a fixed height: keep each line short).',
    screen: 'heritage',
    label: 'Tiêu đề, dòng 1',
  },
  'heritage.title_2': {
    en: 'that keeps evolving',
    maxLength: 28,
    context: 'Home page, Heritage title, second line; continues the first line as one sentence.',
    screen: 'heritage',
    label: 'Tiêu đề, dòng 2',
  },
  'heritage.cta': {
    en: 'OUR STORY',
    maxLength: 24,
    context: 'Home page, Heritage button to the group’s story (an external page). Written in capitals; an arrow follows it.',
    screen: 'heritage',
    label: 'Nút “Our story”',
  },
  // ── Offers (spec §7.2 content/offers): the section's copy (page props), the card's price wording (the offers
  // loader, on the server) and the note VIEW OFFER puts in the reservation form (the browser) ──
  'offers.title': {
    en: 'Offers',
    maxLength: 30,
    context: 'Home page, title of the Offers section (cards for set menus and special evenings).',
    screen: 'offers',
    label: 'Tiêu đề mục Offers',
  },
  'offers.lede': {
    en: 'Seasonal menus and special evenings across our restaurants — valid until 31 December 2026.',
    maxLength: 160,
    context:
      'Home page, one sentence under the Offers title. Any date written here is plain text: each offer’s own dates (offers.valid_from/valid_until) decide when its card shows.',
    screen: 'offers',
    label: 'Câu dẫn mục Offers',
  },
  'offers.cta': {
    en: 'VIEW OFFER',
    maxLength: 24,
    context: 'Home page, the button on an offer card that opens the reservation form for its restaurant. Capitals; an arrow follows it.',
    screen: 'offers',
    label: 'Nút “View offer” trên thẻ',
  },
  'offers.price_plus_plus': {
    en: '{currency} {amount}++ per guest',
    maxLength: 60,
    vars: ['currency', 'amount'],
    context: 'Offer card, the price when service charge and tax come on top ("++"). {currency} is the code (VND), {amount} the formatted number; keep both.',
    screen: 'offers',
    label: 'Giá chưa gồm phí (++)',
  },
  'offers.price_net': {
    en: '{currency} {amount} net per guest',
    maxLength: 60,
    vars: ['currency', 'amount'],
    context: 'Offer card, the price when service charge and tax are included ("net"). {currency} is the code (VND), {amount} the formatted number; keep both.',
    screen: 'offers',
    label: 'Giá đã gồm phí (net)',
  },
  'offers.note': {
    en: 'Offer: {title}',
    maxLength: 60,
    vars: ['title'],
    context:
      'Reservation form, the note VIEW OFFER fills in for the guest (they can change it); {title} is the offer’s title. Staff also see the offer itself on the booking.',
    screen: 'offers',
    label: 'Ghi chú điền sẵn khi khách bấm View offer',
  },
  // ── Hero (spec §7.2 content/hero): the home page reads them on the server and hands them to the hero (page props);
  // the same three title lines name the page from a hidden <h1> when the hero is left out (phase-6 F-A, L7-16) ──
  'hero.kicker': {
    en: 'People · Culture · Great Food',
    maxLength: 48,
    context: 'Home page, small line above the hero title, over the photo. One line on a phone.',
    screen: 'hero',
    label: 'Dòng nhỏ phía trên tiêu đề',
  },
  'hero.title_1': {
    en: 'Many Flavours.',
    maxLength: 28,
    context:
      'Home page, hero title, line 1 of 3, very large over the photo. Also the start of the page’s hidden heading when the hero is switched off. Keep each line short.',
    screen: 'hero',
    label: 'Tiêu đề, dòng 1',
  },
  'hero.title_2': {
    en: 'Many Destinations.',
    maxLength: 28,
    context: 'Home page, hero title, line 2 of 3. Desktop only: a phone shows lines 1 and 3 (spec §6.5).',
    screen: 'hero',
    label: 'Tiêu đề, dòng 2 (chỉ máy tính)',
  },
  'hero.title_3': {
    en: 'One Furama Cuisine.',
    maxLength: 28,
    context: 'Home page, hero title, line 3 of 3; ends the sentence of lines 1 and 2.',
    screen: 'hero',
    label: 'Tiêu đề, dòng 3',
  },
  'hero.lede': {
    en: 'From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine.',
    maxLength: 160,
    context: 'Home page, one sentence under the hero title, over the photo.',
    screen: 'hero',
    label: 'Câu dẫn',
  },
  'hero.cta_explore': {
    en: 'EXPLORE OUR RESTAURANTS',
    maxLength: 32,
    context: 'Home page, the hero’s main button; scrolls to the restaurants. Capitals; an arrow follows it.',
    screen: 'hero',
    label: 'Nút xem nhà hàng',
  },
  'hero.cta_film': {
    en: 'WATCH THE FILM',
    maxLength: 24,
    context: 'Home page, the hero’s button that opens the film dialog (shown while the film section is on). Capitals.',
    screen: 'hero',
    label: 'Nút xem phim',
  },
  'hero.cta_find': {
    en: 'FIND A RESTAURANT',
    maxLength: 24,
    context: 'Home page, the hero’s button that opens the restaurant finder (phones). Capitals; an arrow follows it.',
    screen: 'hero',
    label: 'Nút tìm nhà hàng',
  },
  'hero.slide_aria': {
    en: 'Slide {n}',
    maxLength: 24,
    vars: ['n'],
    context: 'Screen-reader name of one dot under the hero, which shows that slide. {n} is the slide’s number; keep it.',
    screen: 'hero',
    label: 'Tên nút chọn slide (trình đọc màn hình)',
  },
  // ── The film dialog (spec §5.2 sections[film]): a client component of the chrome (CLIENT_KEYS) ──
  'film.aria': {
    en: 'Furama Cuisine film',
    maxLength: 60,
    context: 'Screen-reader name of the film dialog.',
    screen: 'hero',
    label: 'Tên hộp phim (trình đọc màn hình)',
  },
  'film.close_aria': {
    en: 'Close film',
    maxLength: 40,
    context: 'Screen-reader name of the × button and the backdrop that close the film dialog.',
    screen: 'hero',
    label: 'Nút đóng phim (trình đọc màn hình)',
  },
  'film.title': {
    en: 'One Furama Cuisine',
    maxLength: 40,
    context: 'Film dialog, the large title over the poster while no video link is set.',
    screen: 'hero',
    label: 'Tiêu đề trên poster',
  },
  'film.coming_soon': {
    en: 'THE FILM · COMING SOON',
    maxLength: 40,
    context: 'Film dialog, the small line under the title while no video link is set. Capitals.',
    screen: 'hero',
    label: 'Dòng “sắp ra mắt”',
  },
  'film.player_title': {
    en: 'One Furama Cuisine — the film',
    maxLength: 80,
    context: 'Screen-reader name of the video player (YouTube or Vimeo) inside the film dialog.',
    screen: 'hero',
    label: 'Tên trình phát video (trình đọc màn hình)',
  },
  // ── The "Our Restaurants" section and its cards (spec §7.2: /admin/restaurants): client components of the
  // home page and of "More at …" on a restaurant page (CLIENT_KEYS) ──
  'restaurants.title': {
    en: 'Our Restaurants',
    maxLength: 32,
    context: 'Home page, title of the restaurants section (the grid of every restaurant, with the finder’s filters).',
    screen: 'restaurants',
    label: 'Tiêu đề mục Our Restaurants',
  },
  'restaurants.view_all': {
    en: 'VIEW ALL RESTAURANTS',
    maxLength: 32,
    context: 'Home page, the link beside the restaurants title; clears the filters and shows every restaurant. Capitals; an arrow follows it.',
    screen: 'restaurants',
    label: 'Link xem mọi nhà hàng',
  },
  'restaurants.showing': {
    en: 'Showing {shown} of {total} restaurants',
    maxLength: 60,
    vars: ['shown', 'total'],
    context: 'Home page, above the filtered restaurants: how many match the filters. {shown} and {total} are numbers; keep both.',
    screen: 'restaurants',
    label: 'Số nhà hàng đang hiện khi lọc',
  },
  'restaurants.no_matches': {
    en: 'No matches',
    maxLength: 32,
    context: 'Home page, above the restaurants when the filters match none.',
    screen: 'restaurants',
    label: 'Không có nhà hàng nào khớp (dòng trên)',
  },
  'restaurants.remove_filter_sr': {
    en: ', remove filter',
    maxLength: 40,
    context: 'Screen readers only, after a filter’s name on its chip button (“Vietnamese, remove filter”). Starts with a comma and a space.',
    screen: 'restaurants',
    label: 'Đuôi tên nút bỏ bộ lọc (trình đọc màn hình)',
  },
  'restaurants.clear_all': {
    en: 'CLEAR ALL',
    maxLength: 24,
    context: 'Home page, the button that removes every restaurant filter. Capitals.',
    screen: 'restaurants',
    label: 'Nút bỏ mọi bộ lọc',
  },
  'restaurants.empty_title': {
    en: 'No restaurants match these filters',
    maxLength: 60,
    context: 'Home page, the title of the empty state when the filters match no restaurant.',
    screen: 'restaurants',
    label: 'Không có nhà hàng nào khớp: tiêu đề',
  },
  'restaurants.empty_lede': {
    en: 'Try another cuisine, occasion or destination.',
    maxLength: 100,
    context: 'Home page, one sentence under the empty state’s title.',
    screen: 'restaurants',
    label: 'Không có nhà hàng nào khớp: câu dẫn',
  },
  'restaurants.show_all': {
    en: 'SHOW ALL RESTAURANTS',
    maxLength: 32,
    context: 'Home page, the empty state’s button that clears the filters. Capitals.',
    screen: 'restaurants',
    label: 'Nút hiện mọi nhà hàng',
  },
  'restaurants.card_view': {
    en: 'View restaurant',
    maxLength: 24,
    context: 'A restaurant card, the tag on a restaurant with its own page; the card opens it. An arrow follows it.',
    screen: 'restaurants',
    label: 'Nhãn thẻ: xem nhà hàng',
  },
  'restaurants.card_reserve': {
    en: 'Reserve a table',
    maxLength: 24,
    context: 'A restaurant card, the tag on a restaurant without its own page that books online; the card opens the reservation form. An arrow follows it.',
    screen: 'restaurants',
    label: 'Nhãn thẻ: đặt bàn',
  },
  // ── A restaurant's page (spec §6.4): shared by every restaurant, edited on /admin/restaurants (screen
  // `restaurants`); the hero, the tab bar and "More at" are client components (CLIENT_KEYS), the page reads
  // the highlights' default title on the server ──
  'detail.back_all': {
    en: 'ALL RESTAURANTS',
    maxLength: 32,
    context: 'Restaurant page, the back button above the name (desktop); returns to the home page’s restaurants. Capitals; an arrow comes before it.',
    screen: 'restaurants',
    label: 'Nút quay lại danh sách (máy tính)',
  },
  'detail.back': {
    en: 'BACK',
    maxLength: 16,
    context: 'Restaurant page on a phone, the small back button floating over the photo. Capitals; an arrow comes before it.',
    screen: 'restaurants',
    label: 'Nút quay lại (điện thoại)',
  },
  'detail.story_label': {
    en: 'Brand Story',
    maxLength: 40,
    context: 'Restaurant page, small label above the restaurant’s story, when the restaurant has none of its own (its editor’s “Nhãn câu chuyện”).',
    screen: 'restaurants',
    label: 'Nhãn câu chuyện mặc định',
  },
  'detail.call': {
    en: 'CALL',
    maxLength: 16,
    context: 'Restaurant page and its phone tab bar, the link that calls the restaurant. Capitals.',
    screen: 'restaurants',
    label: 'Nút gọi',
  },
  'detail.map': {
    en: 'MAP',
    maxLength: 16,
    context: 'Restaurant page and its phone tab bar, the link that opens the map in a new tab. Capitals.',
    screen: 'restaurants',
    label: 'Nút bản đồ',
  },
  'detail.menu': {
    en: 'MENU',
    maxLength: 16,
    context: 'Restaurant page and its phone tab bar: opens the menu PDF, or scrolls to the highlights without one. Capitals.',
    screen: 'restaurants',
    label: 'Nút thực đơn',
  },
  'detail.actions_aria': {
    en: 'Restaurant actions',
    maxLength: 60,
    context: 'Screen-reader name of the phone tab bar of a restaurant page (CALL, MAP, MENU, RESERVE).',
    screen: 'restaurants',
    label: 'Tên thanh nút của trang nhà hàng (trình đọc màn hình)',
  },
  'detail.highlights_title': {
    en: 'At {name}',
    maxLength: 60,
    vars: ['name'],
    context:
      'Restaurant page, the title above the highlights, when the restaurant has none of its own (its editor’s “Tiêu đề phần nổi bật”). {name} is the restaurant’s name; keep it.',
    screen: 'restaurants',
    label: 'Tiêu đề phần nổi bật mặc định',
  },
  'detail.more_title': {
    en: 'More at {destination}',
    maxLength: 60,
    vars: ['destination'],
    context: 'Restaurant page, the title above the other restaurants of the same destination. {destination} is its name; keep it.',
    screen: 'restaurants',
    label: 'Tiêu đề “nhà hàng khác cùng điểm đến”',
  },
  'detail.more_all': {
    en: 'ALL RESTAURANTS',
    maxLength: 32,
    context: 'Restaurant page, the link beside “More at …” to every restaurant on the home page. Capitals; an arrow follows it.',
    screen: 'restaurants',
    label: 'Link xem mọi nhà hàng',
  },
  // ── Experiences (spec §7.2 content/experiences): the home page reads them on the server and hands them to the
  // section (page props); the rows themselves are experiences rows ──
  'experiences.eyebrow': {
    en: 'Experiences',
    maxLength: 32,
    context: 'Home page, small line above the Experiences title (beside a large photo).',
    screen: 'experiences',
    label: 'Dòng nhỏ phía trên tiêu đề',
  },
  'experiences.title_1': {
    en: 'More than a meal.',
    maxLength: 40,
    context: 'Home page, Experiences title, first of two lines (each line is one short sentence).',
    screen: 'experiences',
    label: 'Tiêu đề, dòng 1',
  },
  'experiences.title_2': {
    en: 'A meaningful experience.',
    maxLength: 40,
    context: 'Home page, Experiences title, second line.',
    screen: 'experiences',
    label: 'Tiêu đề, dòng 2',
  },
  // ── Explore by Cuisine (spec §7.2 content/cuisines): the home page reads them on the server and hands them to the
  // section (page props); the chips themselves are cuisines rows ──
  'cuisines.title': {
    en: 'Explore by Cuisine',
    maxLength: 40,
    context: 'Home page, title of the cuisine rail (round pictures that filter the restaurants by cuisine).',
    screen: 'cuisines',
    label: 'Tiêu đề mục ẩm thực',
  },
  'cuisines.all': {
    en: 'ALL CUISINES',
    maxLength: 32,
    context: 'Home page, the link beside the cuisine title; clears the cuisine filter and scrolls to the restaurants. Capitals; an arrow follows it.',
    screen: 'cuisines',
    label: 'Link “mọi ẩm thực”',
  },
  // ── Our Destinations (spec §7.2 content/destinations): the home page reads them on the server and hands them to
  // the section (page props); the cards themselves are destinations rows ──
  'destinations.title': {
    en: 'Our Destinations',
    maxLength: 32,
    context: 'Home page, title of the destinations section (one card per place: the resort, the dining house …).',
    screen: 'destinations',
    label: 'Tiêu đề mục Our Destinations',
  },
  'destinations.lede': {
    en: 'Different places. One culinary family.',
    maxLength: 100,
    context: 'Home page, one sentence under the destinations title.',
    screen: 'destinations',
    label: 'Câu dẫn mục Our Destinations',
  },
  'destinations.count': {
    en: '{count, plural, one {# restaurant} other {# restaurants}}',
    maxLength: 80,
    vars: ['count'],
    context:
      'A destination card, how many restaurants guests can see there; the card filters the restaurants by that place. ICU plural: keep {count, plural, …} and # (the number). An arrow follows it.',
    screen: 'destinations',
    label: 'Số nhà hàng trên thẻ (số ít / số nhiều)',
  },
  // ── Words several parts of the site share (spec §7.2 ui-text: common.*): chrome and client sections (CLIENT_KEYS) ──
  'common.coming_soon': {
    en: 'Coming soon',
    maxLength: 24,
    context: 'A place still to open: the teaser destination card, and the finder’s “More cities” choice. Short.',
    screen: 'ui-text',
    label: 'Sắp có',
  },
  // ── Search overlay: a client component of the chrome (CLIENT_KEYS) ──
  'search.aria': {
    en: 'Search',
    maxLength: 40,
    context: 'Screen-reader name of the search dialog.',
    screen: 'ui-text',
    label: 'Tên hộp tìm kiếm (trình đọc màn hình)',
  },
  'search.close': {
    en: 'Close search',
    maxLength: 40,
    context: 'Screen-reader name of the × button that closes the search dialog.',
    screen: 'ui-text',
    label: 'Nút đóng tìm kiếm (trình đọc màn hình)',
  },
  'search.placeholder': {
    en: 'Search restaurants, cuisines, places',
    maxLength: 60,
    context: 'Search dialog, grey hint inside the empty search box; also its screen-reader name.',
    screen: 'ui-text',
    label: 'Gợi ý trong ô tìm kiếm',
  },
  'search.popular': {
    en: 'POPULAR CUISINES',
    maxLength: 32,
    context: 'Search dialog, label above the cuisine chips shown before the guest types. Capitals.',
    screen: 'ui-text',
    label: 'Nhãn “ẩm thực phổ biến”',
  },
  'search.results': {
    en: '{count, plural, one {# RESULT} other {# RESULTS}}',
    maxLength: 80,
    vars: ['count'],
    context: 'Search dialog, how many restaurants match. ICU plural: keep {count, plural, …} and # (the number). Capitals.',
    screen: 'ui-text',
    label: 'Số kết quả (số ít / số nhiều)',
  },
  'search.view': {
    en: 'View',
    maxLength: 16,
    context: 'Search result action for a restaurant with its own page. An arrow follows it.',
    screen: 'ui-text',
    label: 'Hành động: xem nhà hàng',
  },
  'search.reserve': {
    en: 'Reserve',
    maxLength: 16,
    context: 'Search result action that opens the reservation form. An arrow follows it.',
    screen: 'ui-text',
    label: 'Hành động: đặt bàn',
  },
  'search.none': {
    en: 'No matches for “{query}”. Try a cuisine such as Vietnamese or Italian.',
    maxLength: 160,
    vars: ['query'],
    context: 'Search dialog, nothing matches. {query} is what the guest typed; keep it inside the quotes.',
    screen: 'ui-text',
    label: 'Không có kết quả',
  },
  // ── Meals (service_periods.meal) and the finder's "all" choices: chrome and booking form (CLIENT_KEYS) ──
  'meal.breakfast': {
    en: 'Breakfast',
    maxLength: 20,
    context: 'Name of the Breakfast service: finder Occasion option, filter chip, time group in the reservation form, booking bar note.',
    screen: 'booking',
    label: 'Bữa sáng',
  },
  'meal.lunch': {
    en: 'Lunch',
    maxLength: 20,
    context: 'Name of the Lunch service (same places as meal.breakfast).',
    screen: 'booking',
    label: 'Bữa trưa',
  },
  'meal.dinner': {
    en: 'Dinner',
    maxLength: 20,
    context: 'Name of the Dinner service (same places as meal.breakfast).',
    screen: 'booking',
    label: 'Bữa tối',
  },
  'meal.drinks': {
    en: 'Drinks',
    maxLength: 20,
    context: 'Name of the Drinks service, a bar or lounge sitting (same places as meal.breakfast).',
    screen: 'booking',
    label: 'Đồ uống',
  },
  'finder.all_cuisines': {
    en: 'All cuisines',
    maxLength: 32,
    context: 'Finder, Cuisine dropdown: the choice that does not filter.',
    screen: 'booking',
    label: 'Lựa chọn “mọi ẩm thực”',
  },
  'finder.any_occasion': {
    en: 'Any occasion',
    maxLength: 32,
    context: 'Finder, Occasion dropdown: the choice that does not filter by meal.',
    screen: 'booking',
    label: 'Lựa chọn “mọi dịp”',
  },
  'finder.any_destination': {
    en: 'Any destination',
    maxLength: 32,
    context: 'Finder, Destination dropdown: the choice that does not filter by place.',
    screen: 'booking',
    label: 'Lựa chọn “mọi điểm đến”',
  },
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
    vi: 'Rất tiếc, chúng tôi không thể nhận yêu cầu đặt bàn của bạn ({reference})',
    maxLength: 120,
    vars: ['reference'],
    context: 'Subject of the email a guest gets when staff decline the request. {reference}: keep it.',
    screen: 'emails',
  },
  'email.guest.declined.heading': {
    en: 'Request not confirmed',
    vi: 'Không thể xác nhận đặt bàn',
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
  'email.staff.new.label_offer': {
    en: 'Offer',
    vi: 'Ưu đãi',
    maxLength: 40,
    context: 'Staff notification, label of the offer the guest booked from (VIEW OFFER on the home page); the offer’s title follows it.',
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

/**
 * Keys the browser needs at first paint, passed to SiteProvider by the
 * (guarded) layout: the chrome's client components (reservation form, search,
 * finder, booking bar, film dialog), the restaurants section and its cards, a restaurant
 * page's client parts (its hero, tab bar and "More at") and the policy link. Everything
 * else is read on the
 * server: a page's own section copy (pageKeys), metadata (seo.*), the policy
 * page (legal.*) and emails (email.*).
 */
const CLIENT_PREFIXES = ['error.', 'booking.', 'search.', 'meal.', 'finder.', 'film.', 'detail.', 'restaurants.', 'common.'] as const;
/** Single keys the chrome needs beyond the prefixes: the policy link (form, footer), VIEW OFFER's note (form). */
const CLIENT_SINGLES = ['legal.link', 'offers.note'] as const;
export type ClientKey = Extract<
  StringKey,
  `${'error' | 'booking' | 'search' | 'meal' | 'finder' | 'film' | 'detail' | 'restaurants' | 'common'}.${string}` | (typeof CLIENT_SINGLES)[number]
>;

export const CLIENT_KEYS = STRING_KEYS.filter(
  (k): k is ClientKey => CLIENT_PREFIXES.some((p) => k.startsWith(p)) || (CLIENT_SINGLES as readonly string[]).includes(k),
);

/** The keys of one prefix ("stories" → stories.title, stories.lede): a section's own copy. */
export type SectionKey<P extends string> = Extract<StringKey, `${P}.${string}`>;
export type Copy<P extends string> = Record<SectionKey<P>, string>;

export function sectionKeys<P extends string>(prefix: P): SectionKey<P>[] {
  return STRING_KEYS.filter((k): k is SectionKey<P> => k.startsWith(`${prefix}.`));
}

/** The home sections whose copy the home page reads on the server and passes down as props. */
export const HOME_SECTIONS = ['hero', 'cuisines', 'destinations', 'experiences', 'stories', 'heritage', 'offers'] as const;
export const HOME_KEYS = HOME_SECTIONS.flatMap((s) => sectionKeys(s));

/** Every key one admin screen edits. */
export function keysForScreen(screen: AdminScreen): StringKey[] {
  return STRING_KEYS.filter((k) => REGISTRY[k].screen === screen);
}

export function isStringKey(key: string): key is StringKey {
  return Object.hasOwn(REGISTRY, key);
}

/** The registry's own text for a language other than English; only `vi`, and only where declared. */
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
