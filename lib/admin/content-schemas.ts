import { z } from './zod';

/*
 * The content editors' form schemas (spec §7.3, §7.4: zod before the
 * transaction). A translatable field posts one input per language, named
 * `<field>.<locale>` (TranslatableField); readForm() folds those into
 * `{ <field>: { <locale>: value } }`, so phase 8's locale tabs add keys, not
 * fields. Until then the schemas take `en` only. Empty text is null: the
 * column's CHECK forbids blanks, and NULL means "use the default language".
 */

/** FormData as a plain object: `a.b` keys nest one level; repeated keys keep the last value. */
export function readForm(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string' || key.startsWith('$ACTION')) continue;
    const dot = key.indexOf('.');
    if (dot === -1) out[key] = value;
    else {
      const [field, locale] = [key.slice(0, dot), key.slice(dot + 1)];
      out[field] = { ...(out[field] as Record<string, string> | undefined), [locale]: value };
    }
  }
  return out;
}

const tooLong = (max: number) => `Tối đa ${max} ký tự.`;

/** Free text, '' → null. Counted in code points, like the column's char_length CHECK. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .refine((v) => [...v].length <= max, tooLong(max))
    .transform((v) => (v === '' ? null : v));

const requiredText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .refine((v) => [...v].length <= max, tooLong(max));

/** One translatable field: EN only until phase 8; `required` = the EN row must carry it (the loader drops a row without it). */
export const translatable = (max: number, required?: string) =>
  z.object({ en: required ? requiredText(max, required) : optionalText(max) }, { error: () => (required ? required : 'Thiếu ô tiếng Anh.') });

const isoDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.iso.date({ error: 'Ngày không hợp lệ.' }).nullable());

/**
 * An unticked checkbox is not posted at all. In zod 4 a
 * z.union([z.literal('on'), z.undefined()]) key is still required, so the
 * form would fail; .optional() makes the key optional.
 */
export const checkbox = z
  .literal('on')
  .optional()
  .transform((v) => v === 'on');

/** The page's token (R2): a content hash, or 'deleted' for a record that is gone. */
export const Token = z.string().regex(/^(?:[0-9a-f]{32}|deleted)$/, 'Trang đã cũ, hãy tải lại.');
/** A list item's bigint id. */
export const ListId = z.string().regex(/^\d{1,18}$/);

export const OfferForm = z
  .object({
    restaurantId: z.string({ error: 'Chọn nhà hàng.' }).min(1, 'Chọn nhà hàng.'),
    priceAmount: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v.replace(/[,.\s](?=\d{3}\b)/g, '')))
      .pipe(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'Giá là một số, ví dụ 888000.').nullable()),
    priceBasis: z.enum(['', 'plus_plus', 'net']).transform((v) => (v === '' ? null : v)),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Mã tiền tệ gồm 3 chữ cái, ví dụ VND.'),
    validFrom: isoDate,
    validUntil: isoDate,
    isPublished: checkbox,
    title: translatable(80, 'Nhập tiêu đề tiếng Anh.'),
    schedule: translatable(120),
    venueOverride: translatable(80),
  })
  .superRefine((v, ctx) => {
    if ((v.priceAmount === null) !== (v.priceBasis === null)) {
      ctx.addIssue({ code: 'custom', path: [v.priceAmount === null ? 'priceAmount' : 'priceBasis'], message: 'Giá và cách tính giá đi cùng nhau: nhập cả hai, hoặc bỏ cả hai.' });
    }
    if (v.validFrom && v.validUntil && v.validFrom > v.validUntil) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
    }
  });

/** The fields every write of an existing list item carries: which one, and the page's token. */
export const RecordRef = z.object({ id: ListId, token: Token });

export const RestoreForm = z.object({
  id: z.string().min(1).max(100),
  auditId: z.string().regex(/^\d{1,18}$/),
  side: z.enum(['before', 'after']),
  token: Token,
});

export const OrderForm = z.object({
  token: Token,
  order: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Thứ tự không hợp lệ.' });
        return z.NEVER;
      }
    })
    .pipe(z.array(ListId).max(100)),
});
