import { describe, expect, it } from 'vitest';
import { RecipientForm, SharedInboxForm, TestEmailForm } from './notification-schemas';

/* The "Thông báo email" actions' inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
describe('notification form schemas', () => {
  it('a recipient: the address trimmed, the target its scope needs, staff events only', () => {
    const base = { scope: 'restaurant', restaurantId: 'hura-izakaya', destinationId: '', email: '  bep@furama.test ', events: ['staff.new'], locale: 'vi', active: 'on' };
    expect(RecipientForm.parse(base)).toEqual({
      scope: 'restaurant',
      restaurantId: 'hura-izakaya',
      destinationId: null,
      email: 'bep@furama.test',
      events: ['staff.new'],
      locale: 'vi',
      active: true,
    });
    expect(RecipientForm.parse({ ...base, active: undefined }).active).toBe(false);
    expect(RecipientForm.safeParse({ ...base, restaurantId: '', email: 'a@b@c', events: [] }).error?.flatten().fieldErrors).toEqual({
      email: ['Email không hợp lệ.'],
      events: ['Chọn ít nhất một loại thông báo.'],
      restaurantId: ['Chọn nhà hàng.'],
    });
    expect(RecipientForm.safeParse({ ...base, scope: 'destination', restaurantId: '' }).error?.flatten().fieldErrors).toEqual({ destinationId: ['Chọn điểm đến.'] });
    expect(RecipientForm.safeParse({ ...base, events: ['guest.ack'] }).success).toBe(false);
    expect(RecipientForm.safeParse({ ...base, email: `${'a'.repeat(250)}@x.vn` }).error?.flatten().fieldErrors).toEqual({ email: ['Email tối đa 254 ký tự.'] });
  });

  it('the shared inbox and the test email', () => {
    expect(SharedInboxForm.parse({ email: ' fb@furamavietnam.com ', token: '1759400000000000' })).toEqual({ email: 'fb@furamavietnam.com', token: '1759400000000000' });
    expect(SharedInboxForm.safeParse({ email: '', token: '1' }).error?.flatten().fieldErrors).toEqual({ email: ['Nhập email.'] });
    expect(TestEmailForm.parse({ to: 'it@furama.test', event: 'guest.declined', locale: 'en' })).toEqual({ to: 'it@furama.test', event: 'guest.declined', locale: 'en' });
    expect(TestEmailForm.safeParse({ to: 'it@furama.test', event: 'staff.test', locale: 'en' }).error?.flatten().fieldErrors).toEqual({ event: ['Chọn loại email.'] });
  });
});
