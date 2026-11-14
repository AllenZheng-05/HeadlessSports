import { describe, expect, it } from 'vitest';
import { HAND_COUNT, HAND_STRIDE, HandIndex } from '../../tracking/types';
import { FistDebouncer, handCurl, palmCentre } from './fist';

/** Hand in aspect-corrected space, wrist at (0.5, 0.8), palm 0.1 long, fingers pointing up. */
function makeHand(tipLength: number, scale = 1, aspect = 1): Float32Array {
  const lm = new Float32Array(HAND_COUNT * HAND_STRIDE);
  const set = (i: number, x: number, y: number): void => {
    lm[i * HAND_STRIDE] = (0.5 + x * scale) / aspect;
    lm[i * HAND_STRIDE + 1] = 0.8 + y * scale;
  };
  for (let i = 0; i < HAND_COUNT; i++) set(i, 0, 0);
  const fingers: [number, number, number][] = [
    [HandIndex.INDEX_MCP, HandIndex.INDEX_TIP, -0.03],
    [HandIndex.MIDDLE_MCP, HandIndex.MIDDLE_TIP, 0],
    [HandIndex.RING_MCP, HandIndex.RING_TIP, 0.03],
    [HandIndex.PINKY_MCP, HandIndex.PINKY_TIP, 0.06],
  ];
  for (const [mcp, tip, dx] of fingers) {
    set(mcp, dx, -0.1);
    set(tip, dx, -tipLength);
  }
  return lm;
}

describe('handCurl', () => {
  it('reads an open hand above 1.3 and a fist below 0.9', () => {
    expect(handCurl(makeHand(0.2), 1)).toBeGreaterThan(1.3);
    expect(handCurl(makeHand(0.07), 1)).toBeLessThan(0.9);
  });

  it('is invariant to uniform scale', () => {
    expect(handCurl(makeHand(0.2, 0.3), 1)).toBeCloseTo(handCurl(makeHand(0.2, 1), 1), 4);
  });

  it('is invariant to aspect when x is pre-divided', () => {
    expect(handCurl(makeHand(0.2, 1, 1.78), 1.78)).toBeCloseTo(handCurl(makeHand(0.2), 1), 4);
  });

  it('returns NaN for a degenerate palm', () => {
    expect(handCurl(new Float32Array(HAND_COUNT * HAND_STRIDE), 1)).toBeNaN();
  });
});

describe('palmCentre', () => {
  it('averages wrist and the four MCPs', () => {
    const out = new Float32Array(2);
    palmCentre(makeHand(0.2), out);
    expect(out[0]).toBeCloseTo(0.5 + (-0.03 + 0 + 0.03 + 0.06) / 5, 5);
    expect(out[1]).toBeCloseTo(0.8 + (-0.1 * 4) / 5, 5);
  });
});

describe('FistDebouncer', () => {
  const cfg = { closeBelow: 0.9, openAbove: 1.3, holdFrames: 2 };

  it('needs holdFrames consecutive frames and reports the change once', () => {
    const d = new FistDebouncer(cfg);
    expect(d.known).toBe(false);
    expect(d.update(0.5)).toBeNull();
    expect(d.update(0.5)).toBe('closed');
    expect(d.update(0.5)).toBeNull();
    expect(d.closed).toBe(true);
    expect(d.known).toBe(true);
    expect(d.update(1.8)).toBeNull();
    expect(d.update(1.8)).toBe('opened');
    expect(d.update(1.8)).toBeNull();
  });

  it('does not toggle on flicker', () => {
    const d = new FistDebouncer(cfg);
    d.update(0.5);
    d.update(0.5);
    for (let i = 0; i < 20; i++) expect(d.update(i % 2 === 0 ? 1.8 : 0.5)).toBeNull();
    expect(d.closed).toBe(true);
  });

  it('keeps state inside the hysteresis band and resets the hold counter there', () => {
    const d = new FistDebouncer(cfg);
    d.update(0.5);
    d.update(0.5);
    expect(d.update(1.1)).toBeNull();
    expect(d.closed).toBe(true);
    d.update(1.8);
    d.update(1.1);
    expect(d.update(1.8)).toBeNull();
    expect(d.closed).toBe(true);
  });

  it('reports nothing for an initially open hand but marks it known', () => {
    const d = new FistDebouncer(cfg);
    d.update(1.8);
    expect(d.update(1.8)).toBeNull();
    expect(d.known).toBe(true);
    expect(d.closed).toBe(false);
  });

  it('ignores non-finite observations', () => {
    const d = new FistDebouncer(cfg);
    d.update(0.5);
    expect(d.update(NaN)).toBeNull();
    expect(d.update(0.5)).toBe('closed');
  });
});
