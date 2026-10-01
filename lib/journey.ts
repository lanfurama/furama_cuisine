/**
 * Where the dotted journey line under "Our Destinations" puts its dots, as a
 * percentage of its width: one centred over each of `count` equal columns
 * (12.5, 37.5, 62.5, 87.5 for four cards), and the inset that makes the line
 * start and end on the outer dots.
 */
export function journeyStops(count: number): { inset: number; stops: number[] } {
  return {
    inset: 50 / count,
    stops: Array.from({ length: count }, (_, i) => ((2 * i + 1) * 50) / count),
  };
}
