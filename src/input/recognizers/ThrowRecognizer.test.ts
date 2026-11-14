import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setWrist } from '../testing/frames';
import type { GameEvent, Side } from '../types';
import { recognizerConfig } from './config';
import { ThrowRecognizer } from './ThrowRecognizer';
import { signedCurvature } from './util';

type Pos = (t: number) => [number, number];

/** Distance travelled by an accelerate-then-decelerate move: peak speed L / d at t0 + d. */
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

/** Straight throw from (x0, y0) along `angleDeg` (0 = +x, 90 = up). */
function straight(x0: number, y0: number, angleDeg: number, t0: number, d: number, L: number): Pos {
  const a = (angleDeg * Math.PI) / 180;
  return (t) => {
    const u = inOut(t, t0, d, L);
    return [x0 + Math.cos(a) * u, y0 + Math.sin(a) * u];
  };
}

/** Path whose heading turns by `-k` rad per unit length (k > 0 is clockwise on screen). */
function arc(
  x0: number,
  y0: number,
  headingDeg: number,
  k: number,
  t0: number,
  d: number,
  L: number,
): Pos {
  const pts: [number, number][] = [];
  const n = 400;
  let x = x0;
  let y = y0;
  const h0 = (headingDeg * Math.PI) / 180;
  for (let i = 0; i <= n; i++) {
    pts.push([x, y]);
    const h = h0 - k * ((i / n) * L);
    x += Math.cos(h) * (L / n);
    y += Math.sin(h) * (L / n);
  }
  return (t) => {
    const u = inOut(t, t0, d, L);
    const i = Math.min(n, Math.round((u / L) * n));
    return pts[i];
  };
}

function run(pos: Pos, toMs: number, hand: Side = 'right') {
  const rec = new ThrowRecognizer(hand, recognizerConfig);
  const state = createTestState();
  const { events, emit } = collector();
  drive(rec, state, emit, 0, toMs, (t) => {
    const [x, y] = pos(t);
    setWrist(state, hand, x, y);
  });
  return events;
}

function released(events: GameEvent[]) {
  return ofType(events, 'ThrowReleased');
}

describe('ThrowRecognizer', () => {
  const c = recognizerConfig.throw;

  it('releases once at the speed peak with direction, loft, lateral and style', () => {
    const events = run(straight(0.3, -1.0, 45, 1000, 140, 1.0), 2500);
    const r = released(events);
    expect(r).toHaveLength(1);
    const e = r[0];
    expect(e.hand).toBe('right');
    expect(Math.abs(e.t - 1140)).toBeLessThan(45); // true peak at t0 + d
    expect(e.speed).toBeGreaterThan(5);
    expect(e.speed).toBeLessThan(7.4);
    expect(e.vx).toBeGreaterThan(0);
    expect(e.vy).toBeGreaterThan(0);
    expect(e.loft).toBeGreaterThan(0.65);
    expect(e.loft).toBeLessThan(0.92);
    expect(e.style).toBe('underarm');
    // The wrist at the peak is about (0.3, -1.0) + 0.5 * (0.707, 0.707) from the right shoulder,
    // which sits 0.5 sw right of the shoulder midpoint.
    expect(e.lateral).toBeGreaterThan(0.75);
    expect(e.lateral).toBeLessThan(1.3);
  });

  it('works for the left hand with mirrored signs', () => {
    const events = run(straight(-0.3, -1.0, 135, 1000, 140, 1.0), 2500, 'left');
    const r = released(events);
    expect(r).toHaveLength(1);
    expect(r[0].hand).toBe('left');
    expect(r[0].vx).toBeLessThan(0);
    expect(r[0].lateral).toBeLessThan(-0.75);
    expect(r[0].loft).toBeGreaterThan(0.6);
  });

  it('calls it overarm when the wrist is above the shoulder at the peak', () => {
    const events = run(straight(0.4, 0.6, -30, 1000, 140, 1.2), 2500);
    const r = released(events);
    expect(r).toHaveLength(1);
    expect(r[0].style).toBe('overarm');
    expect(r[0].loft).toBeLessThan(0); // forward and down
  });

  it('a harder throw reports a higher speed', () => {
    const speeds = [220, 170, 130].map(
      (d) => released(run(straight(0.3, -1, 45, 1000, d, 1.0), 2500))[0].speed,
    );
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[2]).toBeGreaterThan(speeds[1]);
  });

  it('ignores a motion whose peak is below minPeak', () => {
    // Peak speed L / d = 0.3 / 0.14 = 2.1 sw/s.
    const events = run(straight(0.3, -1, 45, 1000, 140, 0.3), 2500);
    expect(released(events)).toHaveLength(0);
  });

  it('ignores a slow build-up longer than maxAccelMs', () => {
    const events = run(straight(0.3, -1, 45, 1000, 550, 4.0), 3500);
    expect(released(events)).toHaveLength(0);
  });

  it('ignores motion that starts when the arm was never still (not ready)', () => {
    const wobble = run((t) => [0.3 + 0.35 * Math.sin(t / 150), -1], 2000);
    expect(released(wobble)).toHaveLength(0);
  });

  it('ignores a throw during cooldown and accepts one after', () => {
    const first = straight(0.3, -1, 45, 1000, 140, 1.0);
    // Back to the start with a cut between throws (fine for this test).
    const pos = (gap: number): Pos => {
      const t2 = 1000 + 280 + 40 + gap;
      const sec = straight(0.3, -1, 45, t2, 140, 1.0);
      return (t) => (t < 1000 + 280 + 40 ? first(t) : sec(t));
    };
    expect(released(run(pos(60), 3000))).toHaveLength(1);
    expect(released(run(pos(1000), 4000))).toHaveLength(2);
    expect(c.cooldownMs).toBeGreaterThan(300);
  });

  describe('wind-up', () => {
    it('emits ThrowWindup when the wrist goes back and then reverses, before the release', () => {
      // Drift back 0.5 sw over 600 ms (about 1 sw/s), then forward fast.
      const fwd = straight(0, 0, 45, 1500, 140, 1.0);
      const pos: Pos = (t) => {
        if (t < 1500) return [0.3 - 0.5 * Math.min(1, Math.max(0, (t - 500) / 600)), -1];
        const [x, y] = fwd(t);
        return [-0.2 + x, -1 + y];
      };
      const events = run(pos, 3500);
      const w = ofType(events, 'ThrowWindup');
      const r = released(events);
      expect(w).toHaveLength(1);
      expect(r).toHaveLength(1);
      expect(w[0].hand).toBe('right');
      expect(w[0].t).toBeLessThan(r[0].t);
      expect(w[0].t).toBeLessThan(1600);
    });

    it('with no back-swing the wind-up is the start of acceleration', () => {
      const events = run(straight(0.3, -1, 45, 1000, 140, 1.0), 2500);
      const w = ofType(events, 'ThrowWindup');
      expect(w).toHaveLength(1);
      expect(w[0].t).toBeGreaterThan(1000);
      expect(w[0].t).toBeLessThan(released(events)[0].t);
    });
  });

  describe('curvature', () => {
    it('is positive when the path bends toward screen right as it advances', () => {
      // Heading up (90 deg) with a clockwise turn: bends toward +x.
      const cw = released(run(arc(0.2, -1.2, 90, 1.0, 1000, 140, 1.0), 2500));
      expect(cw).toHaveLength(1);
      expect(cw[0].curvature).toBeGreaterThan(0.5);
      expect(cw[0].curvature).toBeLessThan(1.6);
    });

    it('is negative when the path bends toward screen left', () => {
      const ccw = released(run(arc(0.2, -1.2, 90, -1.0, 1000, 140, 1.0), 2500));
      expect(ccw).toHaveLength(1);
      expect(ccw[0].curvature).toBeLessThan(-0.5);
      expect(ccw[0].curvature).toBeGreaterThan(-1.6);
    });

    it('is near 0 for a straight path', () => {
      const r = released(run(straight(0.2, -1.2, 60, 1000, 140, 1.0), 2500));
      expect(Math.abs(r[0].curvature)).toBeLessThan(0.15);
    });

    it('signedCurvature: up then right is positive, up then left negative, collinear 0', () => {
      expect(signedCurvature(0, 0, 0, 1, 1, 2)).toBeGreaterThan(0);
      expect(signedCurvature(0, 0, 0, 1, -1, 2)).toBeLessThan(0);
      expect(signedCurvature(0, 0, 1, 1, 2, 2)).toBeCloseTo(0, 9);
      // Counter-clockwise on the unit circle: curvature magnitude 1, negative sign.
      expect(signedCurvature(1, 0, 0, 1, -1, 0)).toBeCloseTo(-1, 6);
      expect(signedCurvature(-1, 0, 0, 1, 1, 0)).toBeCloseTo(1, 6);
    });
  });

  it('reset returns to idle', () => {
    const rec = new ThrowRecognizer('right');
    const state = createTestState();
    const { events, emit } = collector();
    const pos = straight(0.3, -1, 45, 1000, 140, 1.0);
    drive(rec, state, emit, 0, 1080, (t) => setWrist(state, 'right', ...pos(t)));
    rec.reset();
    drive(rec, state, emit, 1080, 2500, (t) => setWrist(state, 'right', ...pos(t)));
    expect(released(events)).toHaveLength(0);
  });
});
