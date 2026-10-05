import { SECTION_KEYS } from '@/lib/content/types';
import { toE164 } from '@/lib/phone';
import { HERO_AUTOPLAY_MS, LENGTHS, LIMITS } from './content-rules';
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

/** A list's show/hide switch: the item, and publish '1' (show) or '0' (hide). A missing or other value is invalid, never "hide". */
export const PublishForm = RecordRef.extend({ publish: z.enum(['0', '1']).transform((v) => v === '1') });

export const RestoreForm = z.object({
  id: z.string().min(1).max(100),
  auditId: z.string().regex(/^\d{1,18}$/),
  side: z.enum(['before', 'after']),
  token: Token,
});

/** A list's new order as SortableList posts it: every id, in order, as one JSON field. */
const orderOf = (id: z.ZodType<string>) =>
  z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Thứ tự không hợp lệ.' });
        return z.NEVER;
      }
    })
    .pipe(z.array(id).max(100));

export const OrderForm = z.object({ token: Token, order: orderOf(ListId) });

/**
 * The id of a list whose id is its slug (destinations, cuisines): chosen when
 * the item is added (makeListEditor create), never changed. Digits alone also
 * match, so this is never used for a bigint list.
 */
export const SlugId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60);
/** RecordRef, PublishForm and OrderForm for a list whose id is a slug. */
export const SlugRecordRef = z.object({ id: SlugId, token: Token });
export const SlugPublishForm = SlugRecordRef.extend({ publish: z.enum(['0', '1']).transform((v) => v === '1') });
export const SlugOrderForm = z.object({ token: Token, order: orderOf(SlugId) });

/** A restore of one registry key (spec §7.5): the key, and its row's token as the page drew it ('' while the default shows). */
export const StringRestoreForm = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/).max(100),
  auditId: z.string().regex(/^\d{1,18}$/),
  side: z.enum(['before', 'after']),
  token: z.string().regex(/^\d{0,20}$/, 'Trang đã cũ, hãy tải lại.'),
});

/** A restaurant's id: its first slug (R22), never changed. */
const RestaurantId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

/** "Thêm nhà hàng" (R22): the name, the slug that becomes its id for good, and its destination. */
export const NewRestaurantForm = z.object({
  name: requiredText(LENGTHS.restaurantName.max, 'Nhập tên nhà hàng.'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Chỉ chữ thường không dấu, số và gạch nối, ví dụ taya-house.')
    .max(60, tooLong(60)),
  destinationId: z.string().min(1, 'Chọn điểm đến.'),
});

/** One switch of the restaurants list (shown, archived): which restaurant, its page's token, and the new value. */
export const RestaurantSwitchForm = z.object({ id: RestaurantId, token: Token, value: z.enum(['0', '1']).transform((v) => v === '1') });

/** The restaurants' new order: every id, in order (their ids are slugs, not numbers). */
export const RestaurantOrderForm = z.object({
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
    .pipe(z.array(RestaurantId).max(100)),
});

/** A library file picked in ImagePicker: '' when none, else its id. */
const optionalMedia = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.uuid({ error: 'Chọn một file trong thư viện.' }).nullable());

/**
 * One home section (spec §7.2 content/sections; the hero screen's film part
 * posts the same form, C5): its switch, and its picture and link where the
 * section has them (lib/admin/content-rules.ts SECTION_PARTS). A field the
 * form does not post stays as it is.
 */
export const SectionForm = z.object({
  key: z.enum(SECTION_KEYS),
  token: Token,
  isVisible: checkbox,
  imageId: optionalMedia.optional(),
  link: z
    .string()
    .trim()
    .max(2000, tooLong(2000))
    .transform((v) => (v === '' ? null : v))
    .optional(),
});

/** A hero slide (spec §6.5): its picture, the phone crop (used by the first slide shown), and its switch. */
export const SlideForm = z.object({
  imageId: z.uuid({ error: 'Chọn ảnh cho slide.' }),
  imageMobileId: optionalMedia,
  isPublished: checkbox,
});

/** How long each hero slide shows on desktop, in whole seconds (site_settings.hero_autoplay_ms is milliseconds). */
export const AutoplayForm = z.object({
  token: Token,
  seconds: z.coerce
    .number({ error: 'Nhập một số giây.' })
    .int('Nhập số giây nguyên.')
    .min(HERO_AUTOPLAY_MS.min / 1000, `Từ ${HERO_AUTOPLAY_MS.min / 1000} đến ${HERO_AUTOPLAY_MS.max / 1000} giây.`)
    .max(HERO_AUTOPLAY_MS.max / 1000, `Từ ${HERO_AUTOPLAY_MS.min / 1000} đến ${HERO_AUTOPLAY_MS.max / 1000} giây.`),
});

/** An https link, '' → null (the columns' CHECK: '^https://', at most `max`). */
const httpsUrl = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .pipe(
      z
        .string()
        .max(max, tooLong(max))
        .regex(/^https:\/\/[^\s]+$/, 'Đường dẫn phải bắt đầu bằng https://')
        .nullable(),
    );

/** A list the form keeps in client state and posts as one JSON field (SortableList). */
const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Dữ liệu không hợp lệ, hãy tải lại trang.' });
        return z.NEVER;
      }
    })
    .pipe(schema);

const Highlight = z.object({
  id: z.string().regex(/^\d{1,18}$/).nullable(),
  imageId: z.string(),
  isPublished: z.boolean(),
  title: z.object({ en: z.string().nullable() }),
  detail: z.object({ en: z.string().nullable() }),
});

/**
 * One restaurant's content (spec §7.2 /admin/restaurants/[id]): the row, its
 * EN texts, its menu (an uploaded PDF or a link), its cuisines and highlights
 * (both posted as JSON by their SortableList). The phone is typed once and
 * stored in both forms (phone_display, phone_e164: CHECK restaurants_phone_pair).
 * What a shown restaurant or an open page needs (a card picture, a type, a
 * portrait, a story) is a rule of the save (lib/server/content-admin/restaurants.ts),
 * so a hidden draft (R22) saves without them.
 */
export const RestaurantForm = z
  .object({
    token: Token,
    name: requiredText(LENGTHS.restaurantName.max, 'Nhập tên nhà hàng.'),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Chỉ chữ thường không dấu, số và gạch nối, ví dụ taya-house.')
      .max(60, tooLong(60)),
    destinationId: z.string().min(1, 'Chọn điểm đến.'),
    isPublished: checkbox,
    hasDetailPage: checkbox,
    cardImageId: optionalMedia,
    detailImageId: optionalMedia,
    ogImageId: optionalMedia,
    phoneDisplay: optionalText(30),
    mapUrl: httpsUrl(2000),
    typeLabel: translatable(60),
    detailKicker: translatable(100),
    storyLabel: translatable(40),
    story: translatable(1500),
    highlightsTitle: translatable(60),
    menuPdfMediaId: z.object({ en: optionalMedia }),
    menuPdfUrl: z.object({ en: httpsUrl(2000) }),
    seoTitle: translatable(120),
    seoDescription: translatable(320),
    cuisines: json(z.array(z.string().max(40)).max(LIMITS.cuisines.max, `Tối đa ${LIMITS.cuisines.max} ẩm thực.`)),
    highlights: json(z.array(Highlight).max(10, 'Tối đa 10 điểm nổi bật (kể cả mục ẩn).')),
  })
  .transform((v, ctx) => {
    const phoneE164 = v.phoneDisplay ? toE164(v.phoneDisplay) : null;
    if (v.phoneDisplay && !phoneE164) ctx.addIssue({ code: 'custom', path: ['phoneDisplay'], message: 'Số điện thoại không hợp lệ.' });
    // Only a crafted form repeats these (the pickers cannot): a cuisine twice would hit restaurant_cuisines' key as a raw 500,
    // a highlight id twice would write one highlight in two places.
    if (new Set(v.cuisines).size !== v.cuisines.length) ctx.addIssue({ code: 'custom', path: ['cuisines'], message: 'Mỗi ẩm thực chỉ chọn một lần.' });
    const ids = v.highlights.flatMap((h) => (h.id === null ? [] : [h.id]));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['highlights'], message: 'Dữ liệu không hợp lệ, hãy tải lại trang.' });
    const highlights = v.highlights.map((h, i) => {
      const title = h.title.en?.trim() ?? '';
      const detail = h.detail.en?.trim() ?? '';
      const at = `Điểm nổi bật ${i + 1}`;
      if (!z.uuid().safeParse(h.imageId).success) ctx.addIssue({ code: 'custom', path: ['highlights'], message: `${at}: chọn ảnh.` });
      if (!title) ctx.addIssue({ code: 'custom', path: ['highlights'], message: `${at}: nhập tiêu đề tiếng Anh.` });
      if ([...title].length > 80) ctx.addIssue({ code: 'custom', path: ['highlights'], message: `${at}: tiêu đề ${tooLong(80).toLowerCase()}` });
      if ([...detail].length > 200) ctx.addIssue({ code: 'custom', path: ['highlights'], message: `${at}: mô tả ${tooLong(200).toLowerCase()}` });
      return { ...h, title: { en: title || null }, detail: { en: detail || null } };
    });
    return { ...v, phoneE164, highlights };
  });

/** An email as typed, '' → null (destinations.email has a CHECK for one @ with no spaces; z.email is stricter). */
const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.email({ error: 'Email không hợp lệ.' }).max(254, tooLong(254)).nullable());

/**
 * One destination (spec §7.2 content/destinations): its card (picture, two
 * title lines, two blurb lines), the name the dropdowns, the footer and
 * "More at …" print, and the venue's contact lines (address, phone, map,
 * email, footer switch). The id is its slug, typed once when it is added
 * (CHECK destinations_id: a lowercase letter first). The phone is typed once
 * and stored in both forms (CHECK destinations_phone_pair). What a venue
 * needs (an EN name) and how many teasers may show are rules of the save
 * (lib/server/content-admin/destinations.ts).
 */
export const DestinationForm = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Chỉ chữ thường không dấu, số và gạch nối, bắt đầu bằng một chữ, ví dụ dining-house.')
      .max(40, tooLong(40)),
    kind: z.enum(['venue', 'teaser'], { error: 'Chọn loại thẻ.' }),
    isPublished: checkbox,
    showInFooter: checkbox,
    cardImageId: optionalMedia,
    phoneDisplay: optionalText(30),
    email: optionalEmail,
    mapUrl: httpsUrl(2000),
    name: translatable(80),
    cardTitle1: translatable(40),
    cardTitle2: translatable(40),
    cardBlurb1: translatable(60),
    cardBlurb2: translatable(60),
    address: translatable(200),
  })
  .transform((v, ctx) => {
    const phoneE164 = v.phoneDisplay ? toE164(v.phoneDisplay) : null;
    if (v.phoneDisplay && !phoneE164) ctx.addIssue({ code: 'custom', path: ['phoneDisplay'], message: 'Số điện thoại không hợp lệ.' });
    return { ...v, phoneE164 };
  });
