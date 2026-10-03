/**
 * The restaurants.slug CHECK of migration 008: lower-case letters and digits
 * in words joined by single hyphens, at most 60 characters. Only ASCII passes
 * the pattern, so the string's length here is Postgres' length(slug).
 * lib/content/slug.test.ts reads the CHECK back out of the migration, so the
 * two cannot drift apart.
 */
export const RESTAURANT_SLUG = { pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, maxLength: 60 } as const;

/**
 * Whether a URL segment could be a restaurant's slug at all. The restaurant
 * page asks before it reads: a segment that no row can hold is a 404 without
 * a query (R13), and one with a NUL byte never reaches Postgres, which would
 * raise an encoding error on every hit instead of caching the 404.
 */
export function isRestaurantSlug(slug: string): boolean {
  return slug.length <= RESTAURANT_SLUG.maxLength && RESTAURANT_SLUG.pattern.test(slug);
}
