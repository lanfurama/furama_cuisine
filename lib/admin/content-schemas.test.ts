import { describe, expect, it } from 'vitest';
import {
  AutoplayForm,
  checkbox,
  DestinationForm,
  NewRestaurantForm,
  OfferForm,
  OrderForm,
  PublishForm,
  readForm,
  RecordRef,
  RestaurantForm,
  RestaurantOrderForm,
  RestaurantSwitchForm,
  RestoreForm,
  SectionForm,
  SlideForm,
  SlugOrderForm,
  SlugPublishForm,
  SlugRecordRef,
} from './content-schemas';
import { z } from './zod';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

const OFFER = {
  restaurantId: 'taya-house',
  priceAmount: '799,000',
  priceBasis: 'plus_plus',
  currency: 'vnd',
  validFrom: '',
  validUntil: '2026-12-31',
  isPublished: 'on',
  'title.en': '  Cooking Class  ',
  'schedule.en': '',
  'venueOverride.en': '',
};

const fieldErrors = (err: unknown) => z.flattenError(err as z.ZodError).fieldErrors as Record<string, string[]>;

describe('content form schemas (spec §7.3, §7.4)', () => {
  it('folds `<field>.<locale>` inputs into one value per language (phase 8 adds keys, not fields)', () => {
    expect(readForm(form({ 'title.en': 'A', 'title.vi': 'B', id: '2', $ACTION_ID_x: '' }))).toEqual({ title: { en: 'A', vi: 'B' }, id: '2' });
  });

  it('an unticked checkbox is simply absent, and reads as false (zod 4: .optional(), not a union with undefined)', () => {
    const Box = z.object({ on: checkbox });
    expect(Box.parse({})).toEqual({ on: false });
    expect(Box.parse({ on: 'on' })).toEqual({ on: true });
    expect(Box.safeParse({ on: 'yes' }).success).toBe(false);
  });

  it('an offer: trims, empties to null, normalises the price and the currency', () => {
    expect(OfferForm.parse(readForm(form(OFFER)))).toEqual({
      restaurantId: 'taya-house',
      priceAmount: '799000',
      priceBasis: 'plus_plus',
      currency: 'VND',
      validFrom: null,
      validUntil: '2026-12-31',
      isPublished: true,
      title: { en: 'Cooking Class' },
      schedule: { en: null },
      venueOverride: { en: null },
    });
    const { isPublished: _on, ...hidden } = OFFER;
    expect(OfferForm.parse(readForm(form(hidden))).isPublished).toBe(false);
  });

  it('an offer needs its EN title; price and basis go together; the dates in order; lengths in characters', () => {
    const bad = { ...OFFER, 'title.en': ' ', priceBasis: '', validFrom: '2027-01-01', 'schedule.en': 'x'.repeat(121) };
    const result = OfferForm.safeParse(readForm(form(bad)));
    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error);
    expect(Object.keys(errors).sort()).toEqual(['priceBasis', 'schedule', 'title', 'validUntil']);
    expect(errors.title[0]).toBe('Nhập tiêu đề tiếng Anh.');
    // 80 Vietnamese characters fit, whatever their UTF-16 length.
    expect(OfferForm.safeParse(readForm(form({ ...OFFER, 'title.en': 'ệ'.repeat(80) }))).success).toBe(true);
  });

  it('a write names its record and the page’s token; a restore names a side; an order is the ids', () => {
    expect(RecordRef.safeParse({ id: '2', token: 'a'.repeat(32) }).success).toBe(true);
    expect(RecordRef.safeParse({ id: '2', token: 'stale' }).success).toBe(false);
    expect(RecordRef.safeParse({ id: '2 OR 1=1', token: 'deleted' }).success).toBe(false);
    expect(RestoreForm.safeParse({ id: '2', auditId: '10', side: 'after', token: 'deleted' }).success).toBe(true);
    expect(RestoreForm.safeParse({ id: '2', auditId: '10', side: 'sideways', token: 'deleted' }).success).toBe(false);
    expect(OrderForm.parse({ token: 'deleted', order: '["3","1","2"]' })).toEqual({ token: 'deleted', order: ['3', '1', '2'] });
    expect(OrderForm.safeParse({ token: 'deleted', order: '[3' }).success).toBe(false);
  });

  it('a section posts its switch, and its picture and link only where it has them (absent: left as they are)', () => {
    const token = 'b'.repeat(32);
    expect(SectionForm.parse(readForm(form({ key: 'hero', token })))).toEqual({ key: 'hero', token, isVisible: false });
    expect(SectionForm.parse(readForm(form({ key: 'film', token, isVisible: 'on', imageId: '', link: ' https://youtu.be/dQw4w9WgXcQ ' })))).toEqual({
      key: 'film',
      token,
      isVisible: true,
      imageId: null,
      link: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(SectionForm.parse(readForm(form({ key: 'film', token, link: '' }))).link).toBeNull();
    expect(SectionForm.safeParse({ key: 'footer', token }).success).toBe(false);
    expect(fieldErrors(SectionForm.safeParse({ key: 'heritage', token, imageId: 'chef.jpg' }).error).imageId).toEqual(['Chọn một file trong thư viện.']);
  });

  it('a hero slide needs its picture; the phone crop is optional; autoplay is 3 to 20 whole seconds', () => {
    const image = '11111111-1111-4111-8111-111111111111';
    expect(SlideForm.parse({ imageId: image, imageMobileId: '', isPublished: 'on' })).toEqual({ imageId: image, imageMobileId: null, isPublished: true });
    expect(fieldErrors(SlideForm.safeParse({ imageMobileId: '' }).error).imageId).toEqual(['Chọn ảnh cho slide.']);
    const token = 'c'.repeat(32);
    expect(AutoplayForm.parse({ token, seconds: '9' })).toEqual({ token, seconds: 9 });
    for (const seconds of ['2', '21', '7.5', '']) expect(AutoplayForm.safeParse({ token, seconds }).success, seconds).toBe(false);
  });

  it('a list’s show/hide switch posts publish 1 or 0; anything else is invalid, never “hide”', () => {
    const token = 'c'.repeat(32);
    expect(PublishForm.parse({ id: '4', token, publish: '1' })).toEqual({ id: '4', token, publish: true });
    expect(PublishForm.parse({ id: '4', token, publish: '0' })).toEqual({ id: '4', token, publish: false });
    for (const publish of [undefined, '', 'yes', 'true', '2']) expect(PublishForm.safeParse({ id: '4', token, publish }).success, String(publish)).toBe(false);
  });

  it('a restaurant: the phone is stored in both forms; highlights are checked one by one with their number; the menu is a file or a link', () => {
    const base = {
      token: 'a'.repeat(32),
      name: 'Tàya House',
      slug: 'taya-house',
      destinationId: 'resort',
      isPublished: 'on',
      cardImageId: '6f1c2a5e-1f3b-4c1d-9a2b-3c4d5e6f7a8b',
      detailImageId: '',
      ogImageId: '',
      phoneDisplay: '0905 111 222',
      mapUrl: '',
      'typeLabel.en': 'Garden Dining',
      'detailKicker.en': '',
      'storyLabel.en': '',
      'story.en': '',
      'highlightsTitle.en': '',
      'menuPdfMediaId.en': '',
      'menuPdfUrl.en': '',
      'seoTitle.en': '',
      'seoDescription.en': '',
      cuisines: '["vietnamese"]',
      highlights: JSON.stringify([{ id: null, imageId: 'nope', isPublished: true, title: { en: '' }, detail: { en: null } }]),
    };
    const result = RestaurantForm.safeParse(readForm(form(base)));
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error).highlights).toEqual(['Điểm nổi bật 1: chọn ảnh.', 'Điểm nổi bật 1: nhập tiêu đề tiếng Anh.']);
    const ok = RestaurantForm.parse(readForm(form({ ...base, highlights: '[]' })));
    expect(ok).toMatchObject({
      phoneDisplay: '0905 111 222',
      phoneE164: '+84905111222',
      hasDetailPage: false,
      detailImageId: null,
      menuPdfMediaId: { en: null },
      menuPdfUrl: { en: null },
      cuisines: ['vietnamese'],
    });
    expect(fieldErrors(RestaurantForm.safeParse(readForm(form({ ...base, highlights: '[]', phoneDisplay: '123' }))).error).phoneDisplay).toEqual([
      'Số điện thoại không hợp lệ.',
    ]);
    expect(fieldErrors(RestaurantForm.safeParse(readForm(form({ ...base, highlights: '[]', 'menuPdfUrl.en': 'http://x' }))).error).menuPdfUrl).toEqual([
      'Đường dẫn phải bắt đầu bằng https://',
    ]);
    // A crafted form: a cuisine twice (the restaurant_cuisines key would refuse it as a raw 500), a highlight id twice.
    expect(fieldErrors(RestaurantForm.safeParse(readForm(form({ ...base, highlights: '[]', cuisines: '["vietnamese","vietnamese"]' }))).error).cuisines).toEqual([
      'Mỗi ẩm thực chỉ chọn một lần.',
    ]);
    const highlight = (id: string | null) => ({ id, imageId: base.cardImageId, isPublished: true, title: { en: 'Garden' }, detail: { en: null } });
    expect(fieldErrors(RestaurantForm.safeParse(readForm(form({ ...base, highlights: JSON.stringify([highlight('5'), highlight('5')]) }))).error).highlights).toEqual([
      'Dữ liệu không hợp lệ, hãy tải lại trang.',
    ]);
    // Two new highlights (id null) are not duplicates.
    expect(RestaurantForm.safeParse(readForm(form({ ...base, highlights: JSON.stringify([highlight(null), highlight(null), highlight('5')]) }))).success).toBe(true);
    // A hidden draft (R22) has no card picture and no type yet: the save's rules ask for them when it shows.
    const { isPublished: _shown, ...hidden } = base;
    expect(RestaurantForm.parse(readForm(form({ ...hidden, highlights: '[]', cardImageId: '', 'typeLabel.en': '' })))).toMatchObject({
      isPublished: false,
      cardImageId: null,
      typeLabel: { en: null },
    });
  });

  it('the restaurants list: a new restaurant’s slug is its id for good; a switch names a restaurant and a value; an order is slugs', () => {
    expect(NewRestaurantForm.parse({ name: ' Sen Garden ', slug: 'sen-garden', destinationId: 'resort' })).toEqual({ name: 'Sen Garden', slug: 'sen-garden', destinationId: 'resort' });
    expect(fieldErrors(NewRestaurantForm.safeParse({ name: '', slug: 'Sen Garden', destinationId: '' }).error)).toEqual({
      name: ['Nhập tên nhà hàng.'],
      slug: ['Chỉ chữ thường không dấu, số và gạch nối, ví dụ taya-house.'],
      destinationId: ['Chọn điểm đến.'],
    });
    const token = 'd'.repeat(32);
    expect(RestaurantSwitchForm.parse({ id: 'taya-house', token, value: '1' })).toEqual({ id: 'taya-house', token, value: true });
    expect(RestaurantSwitchForm.safeParse({ id: 'taya house', token, value: '1' }).success).toBe(false);
    expect(RestaurantOrderForm.parse({ token, order: '["the-fan","taya-house"]' }).order).toEqual(['the-fan', 'taya-house']);
    expect(RestaurantOrderForm.safeParse({ token, order: '["../x"]' }).success).toBe(false);
  });

  it('a destination: its slug starts with a letter; the phone is typed once and stored in both forms; an email or nothing (plan 7B B1)', () => {
    const base = {
      id: 'hoi-an',
      kind: 'venue',
      isPublished: 'on',
      cardImageId: '',
      phoneDisplay: ' 0236 3000 000 ',
      email: '',
      mapUrl: '',
      'name.en': ' Furama Hội An ',
      'cardTitle1.en': 'Furama',
      'cardTitle2.en': '',
      'cardBlurb1.en': '',
      'cardBlurb2.en': '',
      'address.en': '',
    };
    expect(DestinationForm.parse(readForm(form(base)))).toEqual({
      id: 'hoi-an',
      kind: 'venue',
      isPublished: true,
      showInFooter: false,
      cardImageId: null,
      phoneDisplay: '0236 3000 000',
      phoneE164: '+842363000000',
      email: null,
      mapUrl: null,
      name: { en: 'Furama Hội An' },
      cardTitle1: { en: 'Furama' },
      cardTitle2: { en: null },
      cardBlurb1: { en: null },
      cardBlurb2: { en: null },
      address: { en: null },
    });
    expect(fieldErrors(DestinationForm.safeParse(readForm(form({ ...base, id: '2-cities', kind: 'shop', phoneDisplay: '12', email: 'desk', mapUrl: 'http://x' }))).error)).toEqual({
      id: ['Chỉ chữ thường không dấu, số và gạch nối, bắt đầu bằng một chữ, ví dụ dining-house.'],
      kind: ['Chọn loại thẻ.'],
      email: ['Email không hợp lệ.'],
      mapUrl: ['Đường dẫn phải bắt đầu bằng https://'],
    });
    // The phone is checked once the fields are valid (the transform runs after them).
    expect(fieldErrors(DestinationForm.safeParse(readForm(form({ ...base, phoneDisplay: '12' }))).error)).toEqual({ phoneDisplay: ['Số điện thoại không hợp lệ.'] });
  });

  it('a list whose id is a slug (destinations, cuisines): its ref, switch and order take slugs, never a path', () => {
    const token = 'e'.repeat(32);
    expect(SlugRecordRef.parse({ id: 'dining-house', token })).toEqual({ id: 'dining-house', token });
    expect(SlugPublishForm.parse({ id: 'future', token, publish: '0' })).toEqual({ id: 'future', token, publish: false });
    expect(SlugOrderForm.parse({ token, order: '["mm","resort"]' }).order).toEqual(['mm', 'resort']);
    for (const id of ['Dining House', '../x', '']) expect(SlugRecordRef.safeParse({ id, token }).success, id).toBe(false);
    expect(SlugOrderForm.safeParse({ token, order: '["mm","../x"]' }).success).toBe(false);
  });
});
