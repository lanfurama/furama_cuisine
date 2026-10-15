import { BRAND_MARK_F, BRAND_MARK_RULE } from '@/lib/brand-mark';

/** The mark (lib/brand-mark.ts): its rule takes `.brand-mark-rule`'s stroke (styles/layout.css), its F the text colour. Decorative: the link around it carries the name. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className ? `brand-mark ${className}` : 'brand-mark'} viewBox="0 0 64 64" aria-hidden="true">
      <path className="brand-mark-rule" fill="none" strokeLinecap="square" d={BRAND_MARK_RULE} />
      <path fill="currentColor" d={BRAND_MARK_F} />
    </svg>
  );
}
