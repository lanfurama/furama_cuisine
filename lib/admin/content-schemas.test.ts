import { describe, expect, it } from 'vitest';
import { AutoplayForm, checkbox, OfferForm, OrderForm, readForm, RecordRef, RestoreForm, SectionForm, SlideForm } from './content-schemas';
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
});
