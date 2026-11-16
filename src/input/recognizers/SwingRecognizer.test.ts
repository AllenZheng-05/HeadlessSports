import { describe, expect, it } from 'vitest';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setGrip, TEST_SW } from '../testing/frames';
import type { InputState } from '../types';
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

  it('resets when the grip is lost mid-swing for longer than the grace window', () => {
    // Lost from after the start (1100) until 1320: about 200 ms, well past gripGraceMs.
    const events = run(swing(-0.8, -0.2, 0.6, -0.2, 1000, 140), 2500, (t) =>
      t > 1120 && t < 1320 ? 1.5 : 0.1,
    );
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(0);
  });

  it('tolerates two low-visibility frames mid-acceleration (within gripGraceMs)', () => {
    const rec = new SwingRecognizer();
    const state = createTestState();
    const { events, emit } = collector();
    const pos = swing(-0.8, -0.2, 0.6, -0.2, 1000, 140);
    drive(rec, state, emit, 0, 2500, (t) => {
      const [x, y] = pos(t);
      setGrip(state, x, y, 0.1);
      // Two consecutive frames (1120 < t < 1180: frames at 1133 and 1167) with the wrists not visible.
      if (t > 1120 && t < 1180) {
        state.pose[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] = 0.2;
        state.pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE + 3] = 0.2;
      }
    });
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    const peak = ofType(events, 'SwingPeak');
    expect(peak).toHaveLength(1);
    expect(peak[0].speed).toBeGreaterThan(c.minPeak);
  });

  it('a visibility loss longer than the grace resets with no peak', () => {
    const rec = new SwingRecognizer();
    const state = createTestState();
    const { events, emit } = collector();
    const pos = swing(-0.8, -0.2, 0.6, -0.2, 1000, 140);
    drive(rec, state, emit, 0, 2500, (t) => {
      const [x, y] = pos(t);
      setGrip(state, x, y, 0.1);
      if (t > 1120 && t < 1120 + c.gripGraceMs + 100) {
        state.pose[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] = 0.2;
      }
    });
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

  describe('side-on and one-armed swings, and what is not a swing', () => {
    /** A state with a place to leave notes, like the one TrackedInput builds. */
    function noted(): InputState {
      const state = createTestState();
      state.rejected = { seq: 0, t: 0, kind: 'swing', reason: 'slow', speed: 0 };
      return state;
    }

    function drive1(state: InputState, pos: Pos, toMs: number, hide?: (t: number) => number[]) {
      const rec = new SwingRecognizer();
      const { events, emit } = collector();
      drive(rec, state, emit, 0, toMs, (t) => {
        const [x, y] = pos(t);
        setGrip(state, x, y, 0.1);
        for (const w of hide?.(t) ?? []) state.pose[w * POSE_STRIDE + 3] = 0.1;
      });
      return events;
    }

    it('swings seen through one wrist only (the far arm is hidden side-on) still count', () => {
      const pos = swing(-0.8, -0.2, 0.6, -0.2, 1000, 140);
      for (const hidden of [PoseIndex.LEFT_WRIST, PoseIndex.RIGHT_WRIST]) {
        const events = drive1(noted(), pos, 2500, () => [hidden]);
        expect(ofType(events, 'SwingStarted')).toHaveLength(1);
        expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      }
    });

    it('is judged by the stable body scale: a smaller 2D swing at the same speed in sw counts', () => {
      // Excursion 0.6 sw in 160 ms: peak 7.5 sw/s, a short swing as seen from the side.
      const events = drive1(noted(), swing(-0.3, -0.2, 0.3, -0.2, 1000, 80), 2500);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(1);
    });

    it('hands raised straight up are not a swing', () => {
      const events = drive1(noted(), swing(0, -1.2, 0, 0.6, 1000, 140), 2500);
      expect(ofType(events, 'SwingStarted')).toHaveLength(0);
    });

    it('a swing that rises steeply from the start never starts (raising the arms)', () => {
      const state = noted();
      const events = drive1(state, swing(-0.6, -0.5, 0.2, 0.9, 1000, 140), 2500);
      expect(events).toEqual([]);
      expect(state.rejected!.seq).toBe(0);
    });

    it('a swing that starts flat and turns steeply upward starts but is refused a peak, with a note', () => {
      const state = noted();
      // x advances as a normal swing; y only lifts late in it, so the path is 45+ degrees at the peak.
      const pos: Pos = (t) => {
        const u = inOut(t, 1000, 140, 1.0);
        return [-0.8 + u, -0.2 + 1.5 * u * u * u];
      };
      const events = drive1(state, pos, 2500);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(0);
      expect(state.rejected!.seq).toBe(1);
      expect(state.rejected!.kind).toBe('swing');
      expect(state.rejected!.reason).toBe('steep');
      expect(state.rejected!.speed).toBeGreaterThan(c.minPeak);
    });

    it('a weak swing leaves a "slow" note so the sport can say so', () => {
      const state = noted();
      const events = drive1(state, swing(-0.3, -0.2, 0.3, -0.2, 1000, 150), 2500);
      expect(ofType(events, 'SwingPeak')).toHaveLength(0);
      expect(state.rejected!.seq).toBe(1);
      expect(state.rejected!.kind).toBe('swing');
      expect(state.rejected!.reason).toBe('slow');
    });

    it('a slow wide sweep (raising the arms across) never peaks: too slow to be a swing', () => {
      const state = noted();
      const events = drive1(state, swing(-1.2, -0.2, 1.2, -0.2, 1000, 600), 3500);
      expect(ofType(events, 'SwingPeak')).toHaveLength(0);
    });

    it('the waiting waggle never starts a swing', () => {
      const events = drive1(
        noted(),
        (t) => [0.15 * Math.sin((t / 1000) * 2 * Math.PI * 2), -0.2],
        4000,
      );
      expect(events).toEqual([]);
    });

    it('is judged by the body scale in the state, not by the shoulder line in the image', () => {
      // The same swing as the first test, with the body scale given as the test body's own.
      const state = noted();
      expect(state.shoulderWidth).toBe(TEST_SW);
      const events = drive1(state, swing(-0.8, -0.2, 0.6, -0.2, 1000, 140), 2500);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    });

    it('the wrists blurring out for the peak (both) still start the swing from the held speed', () => {
      const pos = swing(-0.8, -0.2, 0.6, -0.2, 1000, 200);
      const events = drive1(noted(), pos, 2500, (t) =>
        t > 1130 && t < 1260 ? [PoseIndex.LEFT_WRIST, PoseIndex.RIGHT_WRIST] : [],
      );
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    });
  });

  describe('round 4: far wrist fading, flicks, the load, one wrist', () => {
    type Vis = (t: number) => [number, number];

    /** Drive the recognizer with a per-frame visibility of the (left, right) wrists. */
    function runVis(pos: Pos, toMs: number, vis: Vis, gap = 0.1, config = recognizerConfig) {
      const rec = new SwingRecognizer(config);
      const state = createTestState();
      state.rejected = { seq: 0, t: 0, kind: 'swing', reason: 'slow', speed: 0 };
      const { events, emit } = collector();
      const emitted: number[] = [];
      let now = 0;
      drive(
        rec,
        state,
        (e) => {
          emitted.push(now);
          emit(e);
        },
        0,
        toMs,
        (t) => {
          now = t;
          const [x, y] = pos(t);
          setGrip(state, x, y, gap);
          const [l, r] = vis(t);
          state.pose[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] = l;
          state.pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE + 3] = r;
        },
      );
      return { events, state, emitted };
    }
    const fwd = swing(-0.8, -0.2, 0.6, -0.2, 1000, 140);

    it('a far wrist hovering around the visibility threshold does not end the swing', () => {
      // The far (right) wrist flickers 0.2 to 0.35 for the whole swing, the near one is clear.
      const flicker: Vis = (t) => [0.95, t < 1160 ? 0.34 : 0.2 + 0.05 * Math.sin(t / 47) ** 2];
      const { events, state } = runVis(fwd, 2500, flicker);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      expect(state.rejected!.seq).toBe(0);
    });

    it('so does a far wrist that was seen (0.33, 0.4, 0.45) when the swing began and then faded', () => {
      for (const v of [0.33, 0.4, 0.45]) {
        const { events } = runVis(fwd, 2500, (t) => [0.95, t < 1160 ? v : 0.2]);
        expect(ofType(events, 'SwingStarted')).toHaveLength(1);
        expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      }
    });

    it('losing one of two faint wrists mid-swing carries on with the other, with no jump', () => {
      // Both wrists are faint (not clearly seen) and 0.6 sw apart, so the grip's midpoint is 0.3 sw
      // from either wrist: switching to one wrist must not look like a 0.3 sw jump (9 sw/s).
      const both: Vis = () => [0.4, 0.4];
      const control = runVis(fwd, 2500, both, 0.6);
      expect(ofType(control.events, 'SwingPeak')).toHaveLength(1);
      const controlPeak = ofType(control.events, 'SwingPeak')[0].speed;
      for (const lost of [0, 1]) {
        const gone: Vis = (t) => {
          const v = t > 1100 ? 0.1 : 0.4;
          return lost === 0 ? [v, 0.4] : [0.4, v];
        };
        const { events, state } = runVis(fwd, 2500, gone, 0.6);
        expect(ofType(events, 'SwingStarted')).toHaveLength(1);
        const peak = ofType(events, 'SwingPeak');
        expect(peak).toHaveLength(1);
        expect(peak[0].speed).toBeLessThan(controlPeak * 1.2);
        expect(peak[0].speed).toBeGreaterThan(controlPeak * 0.8);
        expect(state.rejected!.seq).toBe(0);
      }
    });

    it('a swing is only lost when every wrist has been gone longer than the grace', () => {
      const { events, state } = runVis(fwd, 2500, (t) => (t > 1170 ? [0.1, 0.1] : [0.4, 0.4]), 0.6);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(0);
      expect(state.rejected!.reason).toBe('lost');
    });

    it('a flat flick of one hand at about 3 sw/s is not a swing', () => {
      const flick = swing(-0.2, -0.2, 0.2, -0.2, 1000, 120); // peak about 3.3 sw/s
      for (const hidden of [PoseIndex.LEFT_WRIST, PoseIndex.RIGHT_WRIST]) {
        const { events } = runVis(flick, 2500, () =>
          hidden === PoseIndex.LEFT_WRIST ? [0.1, 0.95] : [0.95, 0.1],
        );
        expect(events).toEqual([]);
      }
    });

    it('grip adjustments (quick small hand slides, both wrists) are not swings', () => {
      const slide = (t0: number): Pos => swing(-0.1, -0.2, 0.1, -0.2, t0, 70);
      const pos: Pos = (t) => (t < 1600 ? slide(1000)(t) : slide(1700)(t));
      expect(runVis(pos, 3000, () => [0.95, 0.95]).events).toEqual([]);
      expect(runVis(pos, 3000, () => [0.95, 0.1]).events).toEqual([]);
    });

    it('a real swing with one wrist still starts, a frame or two after the onset', () => {
      const { events, emitted } = runVis(fwd, 2500, () => [0.95, 0.1]);
      const started = ofType(events, 'SwingStarted');
      expect(started).toHaveLength(1);
      // Stamped at the onset (about 1040 for this swing), announced later.
      expect(started[0].t).toBeGreaterThan(1000);
      expect(started[0].t).toBeLessThan(1110);
      const delay = emitted[0] - started[0].t;
      // The estimator lag (about 66 ms) plus at most confirmMs and a frame (33 ms).
      expect(delay).toBeLessThanOrEqual(66 + c.confirmMs + 34);
    });

    describe('the load before the swing', () => {
      const withForward = (forward: -1 | 0 | 1) => ({
        ...recognizerConfig,
        swing: { ...recognizerConfig.swing, forward },
      });
      // Hands go back 0.9 sw in 280 ms (about 4.5 sw/s at its fastest), then swing forward.
      const loadBack = (dir: number): Pos => {
        const load = swing(0.1 * dir, -0.2, -0.8 * dir, -0.2, 1000, 140);
        const fwdSwing = swing(-0.8 * dir, -0.2, 0.6 * dir, -0.2, 1450, 140);
        return (t) => (t < 1450 ? load(t) : fwdSwing(t));
      };

      it.each([1, -1] as const)(
        'with forward = %i the load is ignored, the swing counts once',
        (dir) => {
          const { events } = runVis(loadBack(dir), 3000, () => [0.95, 0.95], 0.1, withForward(dir));
          const started = ofType(events, 'SwingStarted');
          expect(started).toHaveLength(1);
          expect(started[0].t).toBeGreaterThan(1450);
          expect(started[0].t).toBeLessThan(1600);
          expect(started[0].direction).toBe(dir);
          expect(ofType(events, 'SwingPeak')).toHaveLength(1);
        },
      );

      it('the same with a single wrist', () => {
        const { events } = runVis(loadBack(1), 3000, () => [0.95, 0.1], 0.1, withForward(1));
        expect(ofType(events, 'SwingStarted')).toHaveLength(1);
        expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      });

      it('with no forward direction set the fast load is taken as the swing (why the sport sets it)', () => {
        const { events } = runVis(loadBack(1), 3000, () => [0.95, 0.95], 0.1, withForward(0));
        expect(ofType(events, 'SwingStarted')[0].t).toBeLessThan(1300);
      });

      it('a hard stroke the other way still counts: the player may stand the other way round', () => {
        const hard = swing(0.6, -0.2, -0.8, -0.2, 1000, 100); // about 14 sw/s backwards
        const { events } = runVis(hard, 2500, () => [0.95, 0.95], 0.1, withForward(1));
        expect(ofType(events, 'SwingStarted')).toHaveLength(1);
        expect(ofType(events, 'SwingStarted')[0].direction).toBe(-1);
      });
    });
  });
});
