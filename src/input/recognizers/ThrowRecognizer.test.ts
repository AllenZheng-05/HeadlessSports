import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setWrist } from '../testing/frames';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { GameEvent, InputState, Side } from '../types';
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

  describe('real arms: blur, cocking, lunging', () => {
    /** Run a wrist path with a hook to edit the state each frame (visibility, shoulders). */
    function runWith(
      pos: Pos,
      toMs: number,
      edit: (state: InputState, t: number) => void,
      withNote = true,
    ) {
      const rec = new ThrowRecognizer('right', recognizerConfig);
      const state = createTestState();
      if (withNote) state.rejected = { seq: 0, t: 0, kind: 'swing', reason: 'slow', speed: 0 };
      const { events, emit } = collector();
      drive(rec, state, emit, 0, toMs, (t) => {
        const [x, y] = pos(t);
        setWrist(state, 'right', x, y);
        edit(state, t);
      });
      return { events, state };
    }
    const wristVis = (state: InputState, v: number): void => {
      state.pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE + 3] = v;
    };

    it('a wrist that blurs out of sight at the speed peak still releases at the peak', () => {
      const pos = straight(0.3, -1.0, 45, 1000, 140, 1.0);
      // Lost from the peak (1140) on, for good: the release comes when the coast runs out.
      const { events } = runWith(pos, 2500, (state, t) => {
        if (t > 1130) wristVis(state, 0);
      });
      const r = released(events);
      expect(r).toHaveLength(1);
      expect(Math.abs(r[0].t - 1140)).toBeLessThan(60);
      expect(r[0].speed).toBeGreaterThan(c.minPeak);
    });

    it('a wrist that is lost before it got fast is no release and not worth a note', () => {
      const pos = straight(0.3, -1.0, 45, 1000, 300, 0.9); // slow: peak 3 sw/s at 1300
      const { events, state } = runWith(pos, 2500, (s, t) => {
        if (t > 1100) wristVis(s, 0);
      });
      expect(released(events)).toHaveLength(0);
      expect(state.rejected!.seq).toBe(0);
    });

    it('a wrist lost on a real but too gentle effort is a lost arm, noted with its hand', () => {
      const pos = straight(0.3, -1.0, 45, 1000, 300, 0.9);
      const { events, state } = runWith(pos, 2500, (s, t) => {
        if (t > 1300) wristVis(s, 0);
      });
      expect(released(events)).toHaveLength(0);
      expect(state.rejected!.seq).toBe(1);
      expect(state.rejected!.kind).toBe('throw');
      expect(state.rejected!.reason).toBe('lost');
      expect(state.rejected!.hand).toBe('right');
      expect(state.rejected!.speed).toBeGreaterThan(c.minPeak * c.noticeFraction);
    });

    it('the note carries the hand of the recognizer that made it', () => {
      for (const hand of ['left', 'right'] as const) {
        const rec = new ThrowRecognizer(hand, recognizerConfig);
        const state = createTestState();
        state.rejected = { seq: 0, t: 0, kind: 'swing', reason: 'slow', speed: 0 };
        const { emit } = collector();
        const pos = straight(0.3, -1, 45, 1000, 140, 0.36); // too weak: peak about 2.6
        drive(rec, state, emit, 0, 2500, (t) => setWrist(state, hand, ...pos(t)));
        expect(state.rejected!.seq).toBe(1);
        expect(state.rejected!.hand).toBe(hand);
      }
    });

    it('a wrist lost at or just after its speed peak is stamped within one lag of the true peak', () => {
      // True peak at 1140. The estimate lags, so the last frames seen are within about 60 ms of it
      // whether the wrist went just before the peak or just after. Moving the stamp back by the
      // full lag (as for a release found after the peak) would put the earliest of these 100 ms
      // early: when the blur takes the wrist it IS the peak.
      const pos = straight(0.3, -1.0, 45, 1000, 140, 1.0);
      for (const lostAfter of [1133, 1166, 1200]) {
        const { events } = runWith(pos, 2500, (state, t) => {
          if (t > lostAfter) wristVis(state, 0);
        });
        const r = released(events);
        expect(r, `lost after ${lostAfter}`).toHaveLength(1);
        expect(Math.abs(r[0].t - 1140), `lost after ${lostAfter}`).toBeLessThan(65);
      }
    });

    it('a short loss inside the coast does not matter', () => {
      const pos = straight(0.3, -1.0, 45, 1000, 140, 1.0);
      const { events } = runWith(pos, 2500, (state, t) => {
        if (t > 1100 && t < 1170) wristVis(state, 0.05);
      });
      expect(released(events)).toHaveLength(1);
    });

    it('a lunge (shoulders moving fast during the throw) does not cancel it', () => {
      const pos = straight(0.3, -1.0, 45, 1000, 140, 1.0);
      const base = createTestState();
      const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
      const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
      const { events } = runWith(pos, 2500, (state, t) => {
        // Both shoulders slide 0.4 sw in 140 ms from the start of the throw, the arm with them.
        const dx = (Math.min(Math.max(t - 1000, 0), 140) / 140) * 0.4 * (0.1 / (16 / 9));
        state.pose[ls] = base.pose[ls] + dx;
        state.pose[rs] = base.pose[rs] + dx;
        state.pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE] += dx;
      });
      expect(released(events)).toHaveLength(1);
    });

    it('a weak cocking movement just before the throw does not hide the throw in its cooldown', () => {
      // A 2.8 sw/s back-swing at 1000, then the real throw at 1300 (peak about 7).
      const cock = straight(0.3, -1.0, 135, 1000, 150, 0.42);
      const fwd = straight(-0.1, -0.8, 45, 1300, 140, 1.0);
      const pos: Pos = (t) => (t < 1300 ? cock(t) : fwd(t));
      const events = runWith(pos, 3000, () => undefined).events;
      const r = released(events);
      expect(r.length).toBeGreaterThanOrEqual(1);
      expect(r[r.length - 1].speed).toBeGreaterThan(5);
      expect(Math.abs(r[r.length - 1].t - 1440)).toBeLessThan(60);
    });

    it('a cocking release between 5 and 6 sw/s hides the whip unless the cap is raised', () => {
      // Cock peaking about 5.5 sw/s at 1140, the whip (about 12 sw/s) 150 ms later.
      const cock = straight(0.3, -1.0, 135, 1000, 140, 0.9);
      const endX = 0.3 + Math.cos((135 * Math.PI) / 180) * 0.9;
      const endY = -1.0 + Math.sin((135 * Math.PI) / 180) * 0.9;
      const whip = straight(endX, endY, -20, 1290, 70, 1.4);
      const pos: Pos = (t) => (t < 1290 ? cock(t) : whip(t));
      const saved = { ...recognizerConfig.throw };
      try {
        expect(recognizerConfig.throw.supersedeMaxPeak).toBe(2);
        const hidden = released(runWith(pos, 3000, () => undefined).events);
        expect(hidden).toHaveLength(1);
        expect(hidden[0].speed).toBeGreaterThan(5);
        expect(hidden[0].speed).toBeLessThan(6);
        recognizerConfig.throw.supersedeMaxPeak = 3;
        const seen = released(runWith(pos, 3000, () => undefined).events);
        expect(seen).toHaveLength(2);
        expect(seen[1].speed).toBeGreaterThan(10);
        expect(seen[1].t - seen[0].t).toBeLessThan(300);
        // The factor is configurable too: a whip must beat the cock by more than 3 times.
        recognizerConfig.throw.supersedeFactor = 3;
        expect(released(runWith(pos, 3000, () => undefined).events)).toHaveLength(1);
      } finally {
        Object.assign(recognizerConfig.throw, saved);
      }
    });

    it('reports how far the wrist travelled and its highest point before the peak', () => {
      const events = runWith(straight(0.4, 0.6, -30, 1000, 140, 1.2), 2500, () => undefined).events;
      const r = released(events)[0];
      expect(r.travel!).toBeGreaterThan(0.5);
      expect(r.topY!).toBeGreaterThan(0.55);
    });

    it('leaves a note for a motion that peaked but was too weak', () => {
      // Peak about 2.4 sw/s: over startSpeed, under minPeak, over the notice fraction.
      const { events, state } = runWith(
        straight(0.3, -1, 45, 1000, 140, 0.36),
        2500,
        () => undefined,
      );
      expect(released(events)).toHaveLength(0);
      expect(state.rejected!.seq).toBe(1);
      expect(state.rejected!.kind).toBe('throw');
      expect(state.rejected!.reason).toBe('slow');
    });
  });
});
