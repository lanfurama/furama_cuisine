import { z } from '@/lib/admin/zod';
import { DEFAULT_MODEL, MODEL_IDS, MODEL_REGIONS, REGIONS } from '@/lib/admin/ai-models';

export const AI_FEATURES = ['translate', 'assist', 'seo', 'alt'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
/** The names staff read; 'check' is the connection check's own usage rows. */
export const FEATURE_LABELS: Record<AiFeature | 'check', string> = {
  translate: 'Dịch',
  assist: 'Trợ lý viết',
  seo: 'SEO',
  alt: 'Mô tả ảnh (alt)',
  check: 'Kiểm tra kết nối',
};
/** Which AI features a page may show (mode not off and the feature enabled). */
export type AiFeatures = Record<AiFeature, boolean>;
export const REASONING = ['minimal', 'low', 'medium', 'high'] as const;

/** Each feature's default max output tokens: a document of 20 items, a rewrite, two SEO lines, one alt. */
const MAX_OUT: Record<AiFeature, number> = { translate: 4000, assist: 1500, seo: 400, alt: 300 };

const feature = (f: AiFeature) =>
  z
    .object({
      enabled: z.boolean().default(true),
      model: z.enum(MODEL_IDS).default(DEFAULT_MODEL),
      region: z.enum(REGIONS).default('global'),
      reasoning: z.enum(REASONING).default('low'),
      maxOutputTokens: z.number().int().min(100).max(8000).default(MAX_OUT[f]),
      systemPrompt: z.string().max(4000, { error: 'Prompt tối đa 4000 ký tự.' }).default(''),
    })
    .refine((c) => MODEL_REGIONS[c.model].includes(c.region), { error: 'Model này không có ở region đã chọn.', path: ['region'] })
    .prefault({});

export const AiSettingsSchema = z.object({
  features: z.object({ translate: feature('translate'), assist: feature('assist'), seo: feature('seo'), alt: feature('alt') }).prefault({}),
  brandVoice: z.string().max(2000, { error: 'Tối đa 2000 ký tự.' }).default(''),
  limits: z
    .object({ perMinute: z.number().int().min(1).max(100).default(10), perDay: z.number().int().min(1).max(5000).default(100) })
    .prefault({}),
  budgetUsd: z.number().min(0).max(10_000).default(20),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type FeatureConfig = AiSettings['features'][AiFeature];

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** The glossary form (FormData strings): a blank language means every language; a blank target is null. */
export const GlossaryForm = z.object({
  id: z.preprocess(blankToNull, z.string().regex(/^\d{1,18}$/).nullable().optional()),
  term: z.string({ error: 'Nhập thuật ngữ.' }).trim().min(1, { error: 'Nhập thuật ngữ.' }).max(80, { error: 'Thuật ngữ tối đa 80 ký tự.' }),
  mode: z.enum(['keep', 'map'], { error: 'Chọn cách xử lý.' }),
  locale: z.preprocess(blankToNull, z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ.' }).nullable().optional()),
  target: z.preprocess(blankToNull, z.string().trim().max(80, { error: 'Chữ thay thế tối đa 80 ký tự.' }).nullable().optional()),
});

export const GlossaryTarget = z.object({ id: z.string().regex(/^\d{1,18}$/) });
