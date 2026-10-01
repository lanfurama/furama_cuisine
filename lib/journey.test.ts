import { describe, expect, it } from 'vitest';
import { journeyStops } from './journey';

describe('journeyStops', () => {
  it('puts four dots exactly where the design had them', () => {
    expect(journeyStops(4)).toEqual({ inset: 12.5, stops: [12.5, 37.5, 62.5, 87.5] });
  });

  it('centres a dot over each card for the other allowed counts (2 to 5)', () => {
    expect(journeyStops(2)).toEqual({ inset: 25, stops: [25, 75] });
    expect(journeyStops(5)).toEqual({ inset: 10, stops: [10, 30, 50, 70, 90] });
    const three = journeyStops(3);
    expect(three.inset).toBeCloseTo(16.667, 3);
    expect(three.stops.map((s) => Math.round(s * 100) / 100)).toEqual([16.67, 50, 83.33]);
  });
});
