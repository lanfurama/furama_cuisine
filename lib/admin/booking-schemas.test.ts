import { describe, expect, it } from 'vitest';
import {
  AutoConfirmForm,
  CancelManyForm,
  ClosureForm,
  EditForm,
  NewReservationForm,
  NoteForm,
  PeriodsForm,
  RulesForm,
  SettingsForm,
  TransitionForm,
} from './booking-schemas';

/* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
describe('booking form schemas', () => {
  it('reads a field the form did not render (undefined, not "") as blank: the inbox "Xác nhận" sends no reason', () => {
    expect(TransitionForm.parse({ id: '12', version: '3', to: 'confirmed', reason: undefined })).toEqual({
      id: '12',
      version: 3,
      to: 'confirmed',
      reason: null,
    });
    expect(TransitionForm.parse({ id: '12', version: '3', to: 'cancelled', reason: '  Khách hủy  ' }).reason).toBe('Khách hủy');
    expect(TransitionForm.safeParse({ id: '12', version: '0', to: 'eaten', reason: '' }).success).toBe(false);
  });

  it('an edit: numbers from strings, blanks to null, Vietnamese messages for what staff typed', () => {
    const base = { id: '7', version: '2', date: '2026-10-05', time: '19:00', guests: '4', name: 'Lan', phone: '0905 000 000' };
    expect(EditForm.parse({ ...base, email: '', note: '  ', overCapacityReason: undefined })).toMatchObject({
      guests: 4,
      email: null,
      note: null,
      overCapacityReason: null,
    });
    expect(EditForm.safeParse({ ...base, date: '2026-02-30', time: '7pm', guests: '0', phone: '123', email: 'x' }).error?.flatten().fieldErrors).toEqual({
      date: ['Chọn một ngày hợp lệ.'],
      time: ['Chọn giờ (HH:MM).'],
      guests: ['Ít nhất 1 khách.'],
      phone: ['Số điện thoại không hợp lệ.'],
      email: ['Email không hợp lệ.'],
    });
  });

  it('a note is not blank and at most 2000 characters', () => {
    expect(NoteForm.safeParse({ id: '7', body: '   ' }).error?.flatten().fieldErrors).toEqual({ body: ['Nhập nội dung ghi chú.'] });
    expect(NoteForm.safeParse({ id: '7', body: 'x'.repeat(2001) }).error?.flatten().fieldErrors).toEqual({ body: ['Ghi chú tối đa 2000 ký tự.'] });
  });

  it('a staff booking: the source, the guest’s language, and the restaurant as an id', () => {
    const base = { restaurant: 'chaoshan-hotpot', date: '2026-10-09', time: '19:00', source: 'phone', locale: 'vi', guests: '30', name: 'Đoàn khách', phone: '0912 345 678' };
    expect(NewReservationForm.parse({ ...base, email: '', note: '', overCapacityReason: 'Đã gọi bếp' })).toMatchObject({
      restaurant: 'chaoshan-hotpot',
      source: 'phone',
      guests: 30,
      email: null,
      overCapacityReason: 'Đã gọi bếp',
    });
    expect(NewReservationForm.safeParse({ ...base, restaurant: 'x;drop', source: 'web', locale: '' }).error?.flatten().fieldErrors).toEqual({
      restaurant: [expect.any(String)],
      source: ['Chọn nguồn đặt bàn.'],
      locale: ['Chọn ngôn ngữ của khách.'],
    });
  });

  it('overrides: a blank one follows the defaults; the switch is a checkbox; the window is 1–90 days like the database', () => {
    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1759400000000000', windowDays: '', leadMinutes: '60', maxParty: '8' })).toEqual({
      restaurant: 'taya-house',
      token: '1759400000000000',
      bookingEnabled: false,
      windowDays: null,
      leadMinutes: 60,
      maxParty: 8,
    });
    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1', bookingEnabled: 'on', windowDays: '90' })).toMatchObject({ bookingEnabled: true, windowDays: 90 });
    expect(RulesForm.safeParse({ restaurant: 'taya-house', token: '1', windowDays: '91', maxParty: '51' }).error?.flatten().fieldErrors).toEqual({
      windowDays: ['Số ngày đặt trước: từ 1 đến 90.'],
      maxParty: ['Số khách tối đa: từ 1 đến 50.'],
    });
  });

  it('service periods arrive as one JSON field, on the grid of their interval', () => {
    const period = { id: null, meal: 'Dinner', weekdays: [1, 2], firstSeating: '18:00', lastSeating: '22:00', intervalMin: 30, coversPerSlot: 8, active: true };
    expect(PeriodsForm.parse({ restaurant: 'thai-siam-kitchen', token: '1', periods: JSON.stringify([period]) }).periods).toEqual([period]);
    const bad = [
      { ...period, lastSeating: '17:00' },
      { ...period, intervalMin: 25 },
      // 18:00 + 45-minute steps never lands on 22:00 (the database CHECK service_periods_grid).
      { ...period, intervalMin: 45 },
      { ...period, weekdays: [] },
    ];
    expect(bad.map((p) => PeriodsForm.safeParse({ restaurant: 'x', token: '1', periods: JSON.stringify([p]) }).error?.issues.map((i) => i.message))).toEqual([
      ['Giờ nhận khách cuối phải từ giờ đầu trở đi.'],
      ['Chọn khoảng cách giữa các giờ.'],
      ['Giờ cuối phải cách giờ đầu một số lần đúng bằng khoảng cách (ví dụ 18:00 → 21:00 với 30 phút).'],
      ['Chọn ít nhất một ngày trong tuần.'],
    ]);
    expect(PeriodsForm.safeParse({ restaurant: 'x', token: '1', periods: 'not json' }).success).toBe(false);
  });

  it('a batch cancel: ticked id:version pairs and a reason', () => {
    expect(CancelManyForm.parse({ items: ['12:3', '7:1'], reason: ' Đóng cửa ' })).toEqual({ items: ['12:3', '7:1'], reason: 'Đóng cửa' });
    expect(CancelManyForm.safeParse({ items: [], reason: '' }).error?.flatten().fieldErrors).toEqual({
      items: ['Chọn ít nhất một đặt bàn.'],
      reason: ['Nhập lý do hủy.'],
    });
  });

  it('booking settings: every default inside the database’s bounds, a blank cut-off for none, checkboxes as on/off', () => {
    const base = { token: '1', windowDays: '14', leadMinutes: '30', sameDayCutoff: '', maxParty: '12', piiRetentionMonths: '24' };
    expect(SettingsForm.parse({ ...base, autoConfirm: 'on' })).toEqual({
      token: '1',
      windowDays: 14,
      leadMinutes: 30,
      sameDayCutoff: null,
      maxParty: 12,
      autoConfirm: true,
      guestAckEmail: false,
      piiRetentionMonths: 24,
    });
    expect(SettingsForm.safeParse({ ...base, windowDays: '91', leadMinutes: '-1', sameDayCutoff: '25:00', maxParty: '0', piiRetentionMonths: '121' }).error?.flatten().fieldErrors).toEqual({
      windowDays: ['Từ 1 đến 90 ngày.'],
      leadMinutes: ['Từ 0 đến 1440 phút.'],
      sameDayCutoff: ['Chọn giờ (HH:MM).'],
      maxParty: ['Từ 1 đến 50 khách.'],
      piiRetentionMonths: ['Từ 1 đến 120 tháng.'],
    });
  });

  it('booking settings: a blank number is a required field, never 0; a blank per-restaurant override still follows the defaults', () => {
    const base = { token: '1', windowDays: '14', leadMinutes: '30', sameDayCutoff: '', maxParty: '12', piiRetentionMonths: '24' };
    // Number('') is 0: a cleared lead time must not save as "no lead time" for every restaurant on the default.
    expect(SettingsForm.safeParse({ ...base, windowDays: '', leadMinutes: '  ', maxParty: '', piiRetentionMonths: undefined }).error?.flatten().fieldErrors).toEqual({
      windowDays: ['Nhập số ngày (từ 1 đến 90).'],
      leadMinutes: ['Nhập số phút (0 nếu không cần đặt trước).'],
      maxParty: ['Nhập số khách (từ 1 đến 50).'],
      piiRetentionMonths: ['Nhập số tháng (từ 1 đến 120).'],
    });
    expect(SettingsForm.parse({ ...base, leadMinutes: '0' }).leadMinutes).toBe(0);
    expect(SettingsForm.safeParse({ ...base, leadMinutes: 'abc', maxParty: '2.5' }).error?.flatten().fieldErrors).toEqual({
      leadMinutes: ['Từ 0 đến 1440 phút.'],
      maxParty: ['Từ 1 đến 50 khách.'],
    });
    // RulesForm's overrides are optional: blank (or not sent) is "theo mặc định chung" (NULL), and 0 stays a real 0.
    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1', windowDays: ' ', leadMinutes: '', maxParty: undefined })).toMatchObject({
      windowDays: null,
      leadMinutes: null,
      maxParty: null,
    });
    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1', leadMinutes: '0' }).leadMinutes).toBe(0);
  });

  it('auto-confirm per restaurant: follow the default, on, or off', () => {
    const base = { restaurant: 'danaksara', token: '1' };
    expect(['inherit', 'on', 'off'].map((autoConfirm) => AutoConfirmForm.parse({ ...base, autoConfirm }).autoConfirm)).toEqual([null, true, false]);
    expect(AutoConfirmForm.safeParse({ ...base, autoConfirm: 'yes' }).success).toBe(false);
  });

  it('a closure: the target its scope needs, no meal ticked for the whole day, reasons within the database’s limits', () => {
    // Found by the spike's E2E: the destination select is not rendered for scope 'restaurant', so it arrives undefined.
    expect(
      ClosureForm.parse({ scope: 'restaurant', restaurantId: 'pho-cuon', startsOn: '2026-10-07', endsOn: '2026-10-07', meals: [], reasonEn: '', reasonVi: '', internalNote: '' }),
    ).toEqual({
      scope: 'restaurant',
      destinationId: null,
      restaurantId: 'pho-cuon',
      startsOn: '2026-10-07',
      endsOn: '2026-10-07',
      meals: [],
      showReason: false,
      reasonEn: null,
      reasonVi: null,
      internalNote: null,
    });
    expect(
      ClosureForm.safeParse({ scope: 'destination', startsOn: '2026-10-07', endsOn: '2026-10-06', meals: ['Brunch'], reasonEn: 'x'.repeat(161) }).error?.flatten()
        .fieldErrors,
    ).toEqual({
      meals: [expect.any(String)],
      reasonEn: ['Tối đa 160 ký tự.'],
    });
    expect(ClosureForm.safeParse({ scope: 'destination', startsOn: '2026-10-07', endsOn: '2026-10-06', meals: [] }).error?.flatten().fieldErrors).toEqual({
      endsOn: ['Ngày kết thúc phải từ ngày bắt đầu trở đi.'],
      destinationId: ['Chọn điểm đến.'],
    });
  });
});
