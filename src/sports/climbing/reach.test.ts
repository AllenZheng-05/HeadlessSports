import { describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import { handToWall, wallToHand } from './reach';

describe('reach mapping', () => {
  it('maps the image centre to just above the shoulders and the top to a full stretch', () => {
    const o = { x: 0, y: 0 };
    handToWall(climbingConfig, 0.5, 0.5, o);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0.25);
    handToWall(climbingConfig, 1, 0, o);
    expect(o.x).toBeCloseTo(0.85);
    expect(o.y).toBeCloseTo(1.0);
  });

  it('round-trips through the inverse', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    for (const [x, y] of [
      [0.1, 0.9],
      [0.5, 0.5],
      [0.83, 0.2],
    ] as const) {
      handToWall(climbingConfig, x, y, a);
      wallToHand(climbingConfig, a.x, a.y, b);
      expect(b.x).toBeCloseTo(x, 9);
      expect(b.y).toBeCloseTo(y, 9);
    }
  });
});
