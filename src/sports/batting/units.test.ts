import { describe, expect, it } from 'vitest';
import { formatFeet, metresToFeet } from './units';

describe('batting distance units', () => {
  it('converts metres to whole feet', () => {
    expect(metresToFeet(0)).toBe(0);
    expect(metresToFeet(100)).toBe(328);
    expect(metresToFeet(0.3048)).toBe(1);
    expect(metresToFeet(75)).toBe(246);
  });

  it('formats whole feet with a space and the unit', () => {
    expect(formatFeet(412)).toBe('412 ft');
    expect(formatFeet(0)).toBe('0 ft');
  });
});
