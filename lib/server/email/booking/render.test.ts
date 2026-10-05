import { describe, expect, it } from 'vitest';
import { EMAIL_EVENTS, GUEST_EMAIL_EVENTS, type EmailEvent } from '@/lib/email/events';
import { REGISTRY, type StringDef } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { renderEmail } from '../send';
import { formatEmailDate, formatEmailShortDate, formatEmailTime } from './format';
import type { BookingEmailData } from './load';
import { buildBookingEmail, emailKeys, type EmailKey } from './render';

const EN = { code: 'en', bcp47: 'en' };
const VI = { code: 'vi', bcp47: 'vi' }; // locales.bcp47 as seeded (migration 004)
const ORIGIN = 'https://admin.furama.test';

const booking: BookingEmailData = {
  reservationId: '42',
  reference: 'FC-7K3QH9XA',
  restaurantName: 'Tàya House',
  date: '2026-10-05',
  time: '19:00',
  guests: 4,
  status: 'requested',
  statusReason: 'Nhà hàng có tiệc riêng tối hôm đó.',
  guestName: 'Nguyễn Thị Ánh',
  phone: '0905 123 456',
  email: 'anh.nguyen@guest.vn',
  note: 'Bàn gần cửa sổ.',
  offerTitle: null,
  groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
  anonymized: false,
};

/** The registry's own text for an event, as resolveStrings gives it with no content_strings rows. */
const registryStrings = (event: EmailEvent, locale: string) => resolveStrings([], emailKeys(event), locale, 'en') as Record<EmailKey, string>;

async function render(event: EmailEvent, locale = EN, data: BookingEmailData = booking) {
  const built = buildBookingEmail(event, data, registryStrings(event, locale.code), locale, { adminOrigin: ORIGIN });
  return { subject: built.subject, ...(await renderEmail(built.element)) };
}

describe('registry: email.* keys', () => {
  it('every key an email reads exists, in English and Vietnamese, on the emails screen', () => {
    for (const event of EMAIL_EVENTS) {
      for (const key of emailKeys(event)) {
        const def: StringDef = REGISTRY[key];
        expect(def, key).toBeDefined();
        expect(def.vi, `${key} has no Vietnamese`).toBeTruthy();
        expect(def.screen).toBe('emails');
      }
    }
  });

  // The guest's done screen (phase 4, F2) and the email must say the same thing for each status.
  it('the request and confirmation emails open with the done screen’s words', () => {
    expect(REGISTRY['email.guest.ack.intro'].en).toBe(REGISTRY['booking.done_requested'].en);
    expect(REGISTRY['email.guest.confirmed.intro'].en).toBe(REGISTRY['booking.done_confirmed'].en);
  });
});

describe('dates and times in the email’s language, on Da Nang’s calendar whatever the server zone', () => {
  it('formats the sitting for English and Vietnamese', () => {
    expect(formatEmailDate('2026-10-05', 'en')).toBe('Monday, October 5, 2026');
    expect(formatEmailDate('2026-10-05', 'vi')).toBe('Thứ Hai, 5 tháng 10, 2026');
    expect(formatEmailShortDate('2026-10-05', 'en')).toBe('Mon, Oct 5, 2026');
    expect(formatEmailTime('19:00', 'en')).toBe('7:00 PM');
    expect(formatEmailTime('19:00', 'vi')).toBe('19:00');
    expect(formatEmailTime('00:30', 'vi')).toBe('00:30');
  });

  it('falls back to English formatting for a tag Intl rejects, instead of failing the send', () => {
    expect(formatEmailDate('2026-10-05', 'not a tag!')).toBe('Monday, October 5, 2026');
  });
});

describe('booking emails', () => {
  it.each(EMAIL_EVENTS.flatMap((event) => [EN, VI].map((locale) => [event, locale.code, locale] as const)))(
    '%s in %s: subject, html and text carry the booking, every placeholder filled',
    async (event, _code, locale) => {
      const { subject, html, text } = await render(event, locale);
      expect(subject).toContain('FC-7K3QH9XA');
      for (const out of [html, text]) {
        expect(out).toContain('FC-7K3QH9XA');
        expect(out).toContain('Tàya House');
        expect(out).toContain(locale === EN ? 'Monday, October 5, 2026' : 'Thứ Hai, 5 tháng 10, 2026');
        expect(out).toContain(locale === EN ? '7:00 PM (Da Nang time, GMT+7)' : '19:00 (giờ Đà Nẵng, GMT+7)');
      }
      for (const out of [subject, text]) expect(out).not.toMatch(/\{\w+\}/);
      expect(html).toContain(`lang="${locale.bcp47}"`);
      expect(text).not.toMatch(/<[a-z]/i);
    },
  );

  it('the plain-text part lists the details as aligned label/value lines', async () => {
    const { text } = await render('guest.confirmed');
    expect(text).toMatch(/^Reference\s{2,}FC-7K3QH9XA$/m);
    expect(text).toMatch(/^Guests\s{2,}4$/m);
  });

  it('guest emails: their own words, the restaurant’s number as a tel: link, no admin link, no guest contact details', async () => {
    for (const event of GUEST_EMAIL_EVENTS) {
      const { html, text } = await render(event);
      expect(html).toContain('href="tel:+842366519999"');
      expect(text).toContain('Please call us on +84 236 651 9999.');
      expect(html).not.toContain('/admin/');
      for (const out of [html, text]) {
        expect(out).not.toContain('0905 123 456');
        expect(out).not.toContain('Bàn gần cửa sổ.');
      }
    }
  });

  it('declined and cancelled quote the reason; the request and confirmation never show one', async () => {
    for (const [event, shows] of [
      ['guest.declined', true],
      ['guest.cancelled', true],
      ['guest.ack', false],
      ['guest.confirmed', false],
    ] as const) {
      const { text } = await render(event);
      expect(text.includes('Nhà hàng có tiệc riêng tối hôm đó.'), event).toBe(shows);
    }
    const { text } = await render('guest.cancelled', EN, { ...booking, statusReason: '  ' });
    expect(text).not.toContain('Reason');
  });

  it('the Vietnamese decline reads as final, like its intro: “không thể”, never the pending “chưa” (F11)', async () => {
    const strings = registryStrings('guest.declined', 'vi');
    for (const line of [strings['email.guest.declined.subject'], strings['email.guest.declined.heading']]) {
      expect(line).toMatch(/không thể/i);
      expect(line).not.toMatch(/chưa/i);
    }
    const { subject, text } = await render('guest.declined', VI);
    expect(subject).toBe('Rất tiếc, chúng tôi không thể nhận yêu cầu đặt bàn của bạn (FC-7K3QH9XA)');
    expect(text).toContain('Không thể xác nhận đặt bàn');
    expect(text).not.toMatch(/chưa/i);
    // English is unchanged.
    expect((await render('guest.declined', EN)).subject).toBe('We could not confirm your table request (FC-7K3QH9XA)');
  });

  it('the request and confirmation open with the same words as the done screen of the form', async () => {
    expect((await render('guest.ack')).text).toContain('Your table request at Tàya House has been received. Our team will contact you shortly to confirm.');
    expect((await render('guest.confirmed')).text).toContain('Your table at Tàya House is confirmed. We look forward to welcoming you.');
  });

  it('staff.new: Vietnamese, the guest’s details and own request, a link to the booking, whether staff must act', async () => {
    const { subject, html, text } = await render('staff.new', VI);
    expect(subject).toBe('Đặt bàn mới FC-7K3QH9XA: Tàya House, Th 2, 5 thg 10, 2026 19:00, 4 khách');
    for (const out of [html, text]) {
      expect(out).toContain('Nguyễn Thị Ánh');
      expect(out).toContain('0905 123 456');
      expect(out).toContain('anh.nguyen@guest.vn');
      expect(out).toContain('Bàn gần cửa sổ.');
      expect(out).toContain(`${ORIGIN}/admin/reservations/42`);
    }
    expect(text).toContain('Vui lòng xác nhận hoặc từ chối');
    // The staff email shows no decline reason: it has none to show.
    expect(text).not.toContain('Nhà hàng có tiệc riêng');
    const auto = await render('staff.new', VI, { ...booking, status: 'confirmed', email: null, note: null });
    expect(auto.text).toContain('Đặt bàn đã được tự động xác nhận.');
    expect(auto.text).not.toContain('Yêu cầu của khách');
    expect(auto.text).not.toMatch(/^Email\s/m);
  });

  it('staff.new names the offer the guest booked from, and only staff.new (L7-11)', async () => {
    const withOffer = { ...booking, offerTitle: 'Vietnamese Cooking Class' };
    const vi = await render('staff.new', VI, withOffer);
    for (const out of [vi.html, vi.text]) expect(out).toContain('Vietnamese Cooking Class');
    expect(vi.text).toMatch(/Ưu đãi\s+Vietnamese Cooking Class/);
    expect((await render('staff.new', EN, withOffer)).text).toMatch(/Offer\s+Vietnamese Cooking Class/);
    expect((await render('staff.new', VI)).text).not.toContain('Ưu đãi');
    expect((await render('guest.confirmed', EN, withOffer)).text).not.toContain('Vietnamese Cooking Class');
  });

  it('staff.new opens with the status the booking was created with, when the outbox row names its event (T5.1)', async () => {
    const built = buildBookingEmail('staff.new', { ...booking, status: 'confirmed' }, registryStrings('staff.new', 'vi'), VI, { adminOrigin: ORIGIN, createdStatus: 'requested' });
    const { text } = await renderEmail(built.element);
    expect(text).toContain('Vui lòng xác nhận hoặc từ chối');
  });

  it('each guest email reads its own three keys, then the shared lines (one table, T5.3)', () => {
    expect(emailKeys('guest.declined').slice(6)).toEqual([
      'email.guest.declined.subject',
      'email.guest.declined.heading',
      'email.guest.declined.intro',
      'email.common.label_reason',
      'email.common.contact',
      'email.common.footer_guest',
    ]);
    expect(emailKeys('guest.ack').slice(6)).toEqual(['email.guest.ack.subject', 'email.guest.ack.heading', 'email.guest.ack.intro', 'email.common.contact', 'email.common.footer_guest']);
  });

  it('staff.new in English says "party of", so one guest still reads right', async () => {
    const { subject } = await render('staff.new', EN, { ...booking, guests: 1 });
    expect(subject).toBe('New booking FC-7K3QH9XA: Tàya House, Mon, Oct 5, 2026 7:00 PM, party of 1');
  });

  it('escapes what a guest typed: their text cannot become markup', async () => {
    const { html } = await render('staff.new', VI, { ...booking, guestName: '<img src=x onerror=alert(1)>', note: '<a href="https://evil">click</a>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<a href="https://evil"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('without a destination phone the contact line is left out, not printed with an empty number', async () => {
    const { text } = await render('guest.confirmed', EN, { ...booking, groupPhone: null });
    expect(text).not.toContain('Please call us');
  });
});

describe('the staff link', () => {
  it('appears once in the plain text (the button), and twice in the html (button and fallback link)', async () => {
    const { html, text } = await render('staff.new', VI);
    expect(text.split(`${ORIGIN}/admin/reservations/42`)).toHaveLength(2);
    expect(html.split(`href="${ORIGIN}/admin/reservations/42"`)).toHaveLength(3);
  });
});
