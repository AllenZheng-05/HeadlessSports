import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setGrip } from '../testing/frames';
import { recognizerConfig } from './config';
import { SwingRecognizer } from './SwingRecognizer';

type Pos = (t: number) => [number, number];

function inOut(t: number, t0: number, d: number, L: number): number {
  if (t <= t0) return 0;
  if (t < t0 + d) {
    const p = (t - t0) / d;
    return (L / 2) * p * p;
  }
  if (t < t0 + 2 * d) {
    const q = (t - t0 - d) / d;
    return L / 2 + (L / 2) * (1 - (1 - q) * (1 - q));
  }
  return L;
}

/** Grip midpoint (sw from the shoulder midpoint) moving along a line. */
function swing(x0: number, y0: number, x1: number, y1: number, t0: number, d: number): Pos {
  const L = Math.hypot(x1 - x0, y1 - y0);
  return (t) => {
    const f = inOut(t, t0, d, L) / L;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  };
}

function run(pos: Pos, toMs: number, gap: (t: number) => number = () => 0.1) {
  const rec = new SwingRecognizer();
  const state = createTestState();
  const { events, emit } = collector();
  drive(rec, state, emit, 0, toMs, (t) => {
    const [x, y] = pos(t);
    setGrip(state, x, y, gap(t));
  });
  return events;
}

describe('SwingRecognizer', () => {
  const c = recognizerConfig.swing;

  it('emits SwingStarted then SwingPeak, stamped at the speed peak', () => {
    const events = run(swing(-0.8, -0.2, 0.6, -0.2, 1000, 140), 2500);
    const started = ofType(events, 'SwingStarted');
    const peak = ofType(events, 'SwingPeak');
    expect(started).toHaveLength(1);
    expect(peak).toHaveLength(1);
    expect(started[0].t).toBeLessThan(peak[0].t);
    expect(started[0].direction).toBe(1);
    expect(Math.abs(peak[0].t - 1140)).toBeLessThan(45);
    expect(peak[0].speed).toBeGreaterThan(c.minPeak);
    expect(peak[0].speed).toBeLessThan(10.1);
    expect(started[0].speed).toBeGreaterThanOrEqual(c.startSpeed);
    expect(Math.abs(peak[0].plane)).toBeLessThan(0.1);
    expect(started[0].height).toBeCloseTo(-0.2, 1);
    expect(peak[0].height).toBeCloseTo(-0.2, 1);
  });

  it('reports direction -1 for a right-to-left swing', () => {
    const events = run(swing(0.8, -0.2, -0.6, -0.2, 1000, 140), 2500);
    expect(ofType(events, 'SwingStarted')[0].direction).toBe(-1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
  });

  it('reports the height of the grip above the shoulder line and a rising plane', () => {
    const low = run(swing(-0.8, -0.6, 0.6, -0.6, 1000, 140), 2500);
    const high = run(swing(-0.8, 0.4, 0.6, 0.4, 1000, 140), 2500);
    expect(ofType(high, 'SwingStarted')[0].height).toBeGreaterThan(
      ofType(low, 'SwingStarted')[0].height + 0.8,
    );
    const rising = run(swing(-0.8, -0.6, 0.6, 0.2, 1000, 140), 2500);
    expect(ofType(rising, 'SwingPeak')[0].plane).toBeGreaterThan(0.3);
    const falling = run(swing(-0.8, 0.2, 0.6, -0.6, 1000, 140), 2500);
    expect(ofType(falling, 'SwingPeak')[0].plane).toBeLessThan(-0.3);
  });

  it('a weak swing may start but never peaks', () => {
    // Peak speed 0.45 / 0.14 = 3.2 sw/s: above startSpeed, below minPeak.
    const events = run(swing(-0.2, -0.2, 0.25, -0.2, 1000, 140), 2500);
    expect(ofType(events, 'SwingPeak')).toHaveLength(0);
  });

  it('does nothing without a grip (wrists far apart)', () => {
    const events = run(swing(-0.8, -0.2, 0.6, -0.2, 1000, 140), 2500, () => c.gripDistance + 0.4);
    expect(events).toHaveLength(0);
  });

  it('resets when the grip is lost mid-swing', () => {
    const events = run(swing(-0.8, -0.2, 0.6, -0.2, 1000, 140), 2500, (t) =>
      t > 1100 && t < 1200 ? 1.5 : 0.1,
    );
    expect(ofType(events, 'SwingPeak')).toHaveLength(0);
  });

  it('needs to have been still first: no start when the grip forms mid-motion', () => {
    // Moving at constant 4 sw/s from the very first frame.
    const events = run((t) => [-1 + (t / 1000) * 4, -0.2], 600);
    expect(ofType(events, 'SwingStarted')).toHaveLength(0);
  });

  it('respects the cooldown, then accepts another swing', () => {
    const first = swing(-0.8, -0.2, 0.6, -0.2, 1000, 140);
    const pos = (gap: number): Pos => {
      const sec = swing(-0.8, -0.2, 0.6, -0.2, 1300 + gap, 140);
      return (t) => (t < 1300 ? first(t) : sec(t));
    };
    // Cut back to the start at 1300, second swing `gap` later.
    expect(ofType(run(pos(100), 3000), 'SwingPeak')).toHaveLength(1);
    expect(ofType(run(pos(1200), 4000), 'SwingPeak')).toHaveLength(2);
  });

  it('ignores whole-body motion: a sidestep with the grip held steady', () => {
    // The grip midpoint relative to the shoulders does not change.
    const events = run(() => [0, -0.2], 2000);
    expect(events).toHaveLength(0);
  });
});
