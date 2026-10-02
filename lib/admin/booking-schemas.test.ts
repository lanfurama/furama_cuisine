import { describe, expect, it } from 'vitest';
import { EditForm, NewReservationForm, NoteForm, TransitionForm } from './booking-schemas';

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
});
