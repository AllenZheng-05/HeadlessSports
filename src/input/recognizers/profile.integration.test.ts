// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// The first recognizers were fitted to a front-on synthetic player and did nothing on a real
// camera, where a batter and a javelin thrower stand side-on: the shoulders overlap in the image,
// the far arm is barely visible, the wrists travel a short way and blur at the speed peak, and a
// jogging thrower bobs and turns. These tests run such motions (and the things that must NOT
// count: standing, walking into the box, raising the hands, the waiting waggle, arm pump)
// end to end: synthetic player -> source -> TrackedInput (filters, scale, recognizers) -> events.
// Noise is three times the default, and a frame is dropped at the peak where noted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { javelinConfig } from '../../sports/javelin/config';
import { applyJavelinRecognizer } from '../../sports/javelin/recognizer';
import { recognizerConfig } from './config';
import type { Script } from '../../tracking/synthetic/script';
import {
  armUp,
  idle,
  overarmThrow,
  raiseArm,
  twoHandSwing,
} from '../../tracking/synthetic/scripts/moves';
import {
  gripFlick,
  jogSideOn,
  sideOnSwing,
  turnToStance,
  waggle,
  walkIn,
} from '../../tracking/synthetic/scripts/profile';
import { ofType } from '../testing/collect';
import type { GameEvent } from '../types';
import { play } from './profileHarness';

const SEEDS = [1, 2, 3, 4, 5];

const swings = (e: GameEvent[]) => [...ofType(e, 'SwingStarted'), ...ofType(e, 'SwingPeak')];
const throws = (e: GameEvent[]) => ofType(e, 'ThrowReleased');
/** A throw the javelin rules could take: overarm, or the wrist went over the shoulder. */
const overarmThrows = (e: GameEvent[]) =>
  throws(e).filter((x) => x.style === 'overarm' || (x.topY ?? -9) >= 0.1);

function script(name: string, ...parts: Script['steps'][]): Script {
  return { name, steps: parts.flat() };
}

describe.each(SEEDS)('side-on batting, noise seed %i', (seed) => {
  it('a profile swing (shoulders overlapped, far arm faint, blurred peak) is detected once', () => {
    const s = script('side', idle(500), turnToStance({ near: 'left' }), sideOnSwing());
    const { events } = play(s, seed);
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
    // The swing steps begin at 500 + 900 + 300 = 1700 ms; the load takes 400 ms.
    const started = ofType(events, 'SwingStarted')[0];
    expect(started.t).toBeGreaterThan(2000);
    expect(started.t).toBeLessThan(2400);
    expect(started.direction).toBe(1);
  });

  it('works for the other side to the camera and the other direction', () => {
    const s = script(
      'side',
      idle(500),
      turnToStance({ near: 'right', direction: -1 }),
      sideOnSwing({ near: 'right', direction: -1 }),
    );
    const { events } = play(s, seed);
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingStarted')[0].direction).toBe(-1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
  });

  it('a short, low-power swing with a small 2D excursion still counts', () => {
    const s = script(
      'side',
      idle(500),
      turnToStance({ near: 'left' }),
      sideOnSwing({ power: 0.8, reach: 0.6 }),
    );
    const { events } = play(s, seed);
    // The start is what the game times the hit by; the peak (power) may be lost in the blur.
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
  });

  it('survives a dropped frame at the speed peak and the wrists blurring out', () => {
    const s = script('side', idle(500), turnToStance({ near: 'left' }), sideOnSwing());
    // The speed peak is at the seam between swing and follow: 1700 + 400 + d1 (212) = about 2312.
    const { events } = play(s, seed, { drop: [[2290, 2340]] });
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
  });

  it('a front-on swing is still detected with the same noise', () => {
    const s = script('front', idle(500), twoHandSwing({ power: 0.8 }));
    const { events } = play(s, seed, { calibrate: true });
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
  });

  it('a side-on swing is not lost when the batter was calibrated facing the camera', () => {
    const s = script('side', idle(500), turnToStance({ near: 'left' }), sideOnSwing());
    const { events } = play(s, seed, { calibrate: true });
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
  });

  it('standing side-on, turning into the stance, walking in, raising the hands: no swing', () => {
    const still = script('still', idle(500), turnToStance({ near: 'left' }), idle(3000));
    expect(swings(play(still, seed).events)).toEqual([]);
    const walk = script('walk', idle(300), walkIn({ near: 'left' }), idle(1500));
    expect(swings(play(walk, seed).events)).toEqual([]);
    const raise = script('raise', idle(300), raiseArm('left'), raiseArm('right'));
    expect(swings(play(raise, seed).events)).toEqual([]);
    const walkThenStance = script(
      'walk-stance',
      idle(300),
      walkIn({ near: 'left' }),
      turnToStance({ near: 'left', ms: 500 }),
      idle(1500),
    );
    expect(swings(play(walkThenStance, seed).events)).toEqual([]);
  });

  it('the batter waiting (waggle) never starts a swing, then the swing does', () => {
    const s = script(
      'waggle',
      idle(500),
      turnToStance({ near: 'left' }),
      waggle({ ms: 2500, amplitude: 0.18, hz: 2 }),
      sideOnSwing(),
    );
    const { events } = play(s, seed);
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingStarted')[0].t).toBeGreaterThan(1700 + 2500);
  });
});

/** The javelin runs with its own recognizer settings (see sports/javelin/recognizer.ts). */
let restoreJavelin = (): void => undefined;

describe.each(SEEDS)('side-on javelin throw while jogging, noise seed %i', (seed) => {
  beforeEach(() => {
    restoreJavelin = applyJavelinRecognizer(javelinConfig, recognizerConfig);
  });
  afterEach(() => {
    restoreJavelin();
  });

  it('a throw released near shoulder height is reported once, as a fast throw over the shoulder', () => {
    const s = script(
      'jog',
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 }),
    );
    const r = throws(play(s, seed).events);
    const fast = r.filter((x) => x.speed > 5 && x.topY! >= 0.1);
    expect(fast).toHaveLength(1);
    expect(fast[0].hand).toBe('right');
    // The throw begins 400 + 500 + 1800 = 2700 ms in; the speed peak is about 160 ms later.
    expect(fast[0].t).toBeGreaterThan(2720);
    expect(fast[0].t).toBeLessThan(3000);
    expect(fast[0].topY!).toBeGreaterThan(0.2);
    expect(fast[0].travel!).toBeGreaterThan(0.8);
  });

  it('a weaker throw, the other hand and the other side to the camera also count', () => {
    const weak = script(
      'weak',
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800, power: 0.5 }),
    );
    expect(overarmThrows(play(weak, seed).events).filter((x) => x.speed > 4)).toHaveLength(1);
    const left = script(
      'left',
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'left', near: 'left', throwAtMs: 1800 }),
    );
    const l = overarmThrows(play(left, seed).events).filter((x) => x.speed > 5);
    expect(l).toHaveLength(1);
    expect(l[0].hand).toBe('left');
  });

  it('survives a dropped frame at the peak', () => {
    const s = script(
      'jog',
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 }),
    );
    const r = throws(play(s, seed, { drop: [[2830, 2890]] }).events);
    expect(r.filter((x) => x.speed > 4 && x.topY! >= 0.1)).toHaveLength(1);
  });

  it('jogging with a vigorous arm pump and no throw gives no overarm throw', () => {
    const s = script('pump', idle(400), jogSideOn({ ms: 4000, pump: 0.5 }));
    expect(overarmThrows(play(s, seed).events)).toEqual([]);
  });

  it('a sprint pump (wrists up toward the shoulders, 5 to 8 sw/s) gives no overarm throw', () => {
    const sprint = { ms: 6000, pump: 0.45, pumpY: 0.5, stepsPerSecond: 3.5, carryY: -0.55 };
    for (const near of ['left', 'right'] as const) {
      const s = script('sprint', idle(400), jogSideOn({ ...sprint, near }));
      let fastest = 0;
      const { events } = play(s, seed, {
        onFrame: (state) => {
          fastest = Math.max(fastest, state.arms.left.speed, state.arms.right.speed);
        },
      });
      // It really is a hard pump...
      expect(fastest).toBeGreaterThan(5);
      expect(fastest).toBeLessThan(10);
      // ...and still no throw the javelin could take.
      expect(overarmThrows(events)).toEqual([]);
    }
  });

  it('standing side-on and raising the arm slowly gives no fast throw', () => {
    const s = script(
      'raise',
      idle(400),
      turnToStance({ near: 'right' }),
      armUp('right'),
      idle(800),
    );
    expect(throws(play(s, seed).events).filter((x) => x.speed > 4.5)).toEqual([]);
  });
});

describe('front-on throws are unchanged', () => {
  it.each(SEEDS)('overarmThrow is still one release, seed %i', (seed) => {
    const s = script('front', idle(500), overarmThrow('right'));
    // (Raising the arm to cock it is slow and may be a weak release of its own: it is not a throw.)
    const r = throws(play(s, seed, { calibrate: true }).events).filter((x) => x.speed > 5);
    expect(r).toHaveLength(1);
    expect(r[0].style).toBe('overarm');
  });
});

/** The two ways round a right- and a left-handed batter stand: near side, swing direction. */
const STANCES = [
  { name: 'right-handed', near: 'left', direction: 1 },
  { name: 'left-handed', near: 'right', direction: -1 },
] as const;

const savedForward = recognizerConfig.swing.forward;
afterEach(() => {
  recognizerConfig.swing.forward = savedForward;
});

/** A step that only changes controls: the far wrist faint, hovering 0.2 to 0.35. */
function faintFar(near: 'left' | 'right', steps: Script['steps']): Script['steps'] {
  const far = near === 'left' ? 'rightWristVis' : 'leftWristVis';
  const cycle = [0.34, 0.22, 0.3, 0.2, 0.35, 0.25];
  return steps.map((st, i) => ({ ...st, to: { ...st.to, [far]: cycle[i % cycle.length] } }));
}

describe.each(SEEDS)('round 4: side-on batting guards, noise seed %i', (seed) => {
  it.each(STANCES)(
    '$name: a far wrist hovering at 0.2 to 0.35 through the swing is no loss',
    (st) => {
      const lead = [...idle(500), ...turnToStance({ near: st.near, direction: st.direction })];
      const s = script(
        'faint',
        lead,
        faintFar(st.near, [{ dur: 200, label: 'faint' }]),
        faintFar(st.near, sideOnSwing({ near: st.near, direction: st.direction })),
      );
      let lost = 0;
      let seq = 0;
      const { events } = play(s, seed, {
        onFrame: (state) => {
          const r = state.rejected;
          if (r === undefined || r.seq === seq) return;
          seq = r.seq;
          if (r.kind === 'swing' && r.reason === 'lost') lost++;
        },
      });
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      expect(lost).toBe(0);
    },
  );

  it.each(STANCES)('$name: a grip flick, and waggle, then the swing: one swing', (st) => {
    recognizerConfig.swing.forward = st.direction;
    const s = script(
      'flick',
      idle(500),
      turnToStance({ near: st.near, direction: st.direction }),
      gripFlick({ direction: st.direction }),
      waggle({ ms: 1500, amplitude: 0.18, hz: 2, direction: st.direction }),
      gripFlick({ direction: st.direction }),
      sideOnSwing({ near: st.near, direction: st.direction }),
    );
    const { events } = play(s, seed);
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
    // The swing steps begin after the last flick (500 + 900 + 300 + 950 + 1500 + 950 = 5100).
    expect(ofType(events, 'SwingStarted')[0].t).toBeGreaterThan(5100);
  });

  it.each(STANCES)('$name: a flick on its own is no swing, with or without a direction', (st) => {
    for (const forward of [0, st.direction] as const) {
      recognizerConfig.swing.forward = forward;
      const s = script(
        'flick',
        idle(500),
        turnToStance({ near: st.near, direction: st.direction }),
        gripFlick({ direction: st.direction }),
        idle(500),
      );
      expect(swings(play(s, seed).events)).toEqual([]);
    }
  });

  it.each(STANCES)(
    '$name: a hard backward load, then the swing: one swing, at the forward onset',
    (st) => {
      recognizerConfig.swing.forward = st.direction;
      const lead = [...idle(500), ...turnToStance({ near: st.near, direction: st.direction })];
      const start = lead.reduce((a, x) => a + x.dur, 0);
      const swingSteps = sideOnSwing({
        near: st.near,
        direction: st.direction,
        loadBack: 1,
        loadMs: 330,
      });
      const { events } = play(script('load', lead, swingSteps), seed);
      const started = ofType(events, 'SwingStarted');
      expect(started).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(1);
      // The load takes 330 ms, then the forward stroke (onset about 70 ms into it).
      expect(started[0].t).toBeGreaterThan(start + 330);
      expect(started[0].t).toBeLessThan(start + 330 + 260);
      expect(started[0].direction).toBe(st.direction);
    },
  );

  it('the same load with no direction set is taken for the swing (why batting sets it)', () => {
    const lead = [...idle(500), ...turnToStance({ near: 'left' })];
    const start = lead.reduce((a, x) => a + x.dur, 0);
    const s = script('load', lead, sideOnSwing({ loadBack: 1, loadMs: 330 }));
    const started = ofType(play(s, seed).events, 'SwingStarted');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started[0].t).toBeLessThan(start + 330);
  });
});

describe.each(SEEDS)(
  'round 4: the far shoulder is seen, so the width really collapses, seed %i',
  (seed) => {
    // farHide 0: side-on the far shoulder and hip are as visible as the near ones, the live shoulder
    // width is cos(yaw) of the square-on one and the scale must come from the torso.
    const wide = { dur: 50, to: { farHide: 0 } } as const;

    it('the body scale stays near the square-on width through the turn, and the swing is seen once', () => {
      const s = script('wide', [wide], idle(1200), turnToStance({ near: 'left' }), sideOnSwing());
      let squareOn = 0;
      let lo = Infinity;
      let hi = 0;
      const { events } = play(s, seed, {
        onFrame: (state, t) => {
          if (t > 1000 && t < 1200) squareOn = state.shoulderWidth;
          if (t > 2800 && state.shoulderWidth > 0) {
            lo = Math.min(lo, state.shoulderWidth);
            hi = Math.max(hi, state.shoulderWidth);
          }
        },
      });
      expect(squareOn).toBeGreaterThan(0.05);
      // Side-on (yaw 1.45) the live width is about 0.12 of the square-on one; the scale holds up.
      expect(lo).toBeGreaterThan(0.75 * squareOn);
      expect(hi).toBeLessThan(1.15 * squareOn);
      expect(ofType(events, 'SwingStarted')).toHaveLength(1);
      expect(ofType(events, 'SwingPeak')).toHaveLength(1);
    });

    it('a side-on throw with both shoulders in view is one fast throw, of the same speed', () => {
      const jog = jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 });
      const seen = script('wide', [wide], idle(1200), jog);
      const hidden = script('hidden', idle(1200), jog);
      const a = throws(play(seen, seed).events).filter((x) => x.speed > 5 && x.topY! >= 0.1);
      const b = throws(play(hidden, seed).events).filter((x) => x.speed > 5 && x.topY! >= 0.1);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      // The torso scale is 0.8 of the square-on width (the floor), so speeds read up to 1.25 times
      // those of the player whose far shoulder is hidden (which keeps the square-on width), plus noise.
      expect(a[0].speed).toBeGreaterThan(0.9 * b[0].speed);
      expect(a[0].speed).toBeLessThan(1.4 * b[0].speed);
    });
  },
);
