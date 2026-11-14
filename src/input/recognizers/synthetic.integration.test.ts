// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// End to end: synthetic player -> SyntheticSource -> TrackedInput (filters, kinematics,
// recognizers) -> events. Noise is on (the synthetic default) and every key case is repeated over
// seeds 1..5 so the thresholds are not tuned to one noise draw.
import { describe, expect, it } from 'vitest';
import { ScriptPlayer } from '../../tracking/synthetic/script';
import type { Script, ScriptStep } from '../../tracking/synthetic/script';
import { defaultControls } from '../../tracking/synthetic/controls';
import { getScript } from '../../tracking/synthetic/scripts';
import {
  closeFist,
  idle,
  jumpUp,
  leanTo,
  openFist,
  overarmThrow,
  raiseArm,
  runInPlace,
  sidestep,
  squat,
  twoHandSwing,
  underarmSwing,
} from '../../tracking/synthetic/scripts/moves';
import { ofType } from '../testing/collect';
import { runScript, syntheticCalibration } from '../testing/runScript';
import type { GameEvent } from '../types';

const SEEDS = [1, 2, 3, 4, 5];
const NEEDS_NO_HANDS = { pose: true, handCrops: false, fullFrameHands: false };

function script(name: string, steps: ScriptStep[], lead = 500): Script {
  return { name, steps: [...idle(lead), ...steps] };
}

/** True time of the wrist-speed peak of one hand, from the script itself with no noise. */
function truePeakT(s: Script, hand: 'left' | 'right'): number {
  const player = new ScriptPlayer(s);
  const c = defaultControls();
  const at = (t: number): [number, number] => {
    player.sample(t, c);
    return hand === 'right' ? [c.rightWristX, c.rightWristY] : [c.leftWristX, c.leftWristY];
  };
  let best = 0;
  let bestT = 0;
  for (let t = 5; t < player.durationMs - 5; t += 1) {
    const a = at(t - 4);
    const b = at(t + 4);
    const v = Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.008;
    if (v > best) {
      best = v;
      bestT = t;
    }
  }
  return bestT;
}

function releases(events: GameEvent[]) {
  return ofType(events, 'ThrowReleased');
}

describe.each(SEEDS)('synthetic moves, noise seed %i', (seed) => {
  const run = (s: Script, extra = 600) => runScript(s, { seed, extraMs: extra });

  it('raiseArm with a fist: one ArmRaised and one FistClosed, right hand only', () => {
    const { events } = run(script('raise', raiseArm('right', { fist: true })));
    const raised = ofType(events, 'ArmRaised');
    const closed = ofType(events, 'FistClosed');
    expect(raised).toHaveLength(1);
    expect(raised[0].hand).toBe('right');
    expect(raised[0].both).toBe(false);
    expect(closed).toHaveLength(1);
    expect(closed[0].hand).toBe('right');
    expect(ofType(events, 'FistOpened')).toHaveLength(0);
    const leftEvents = events.filter((e) => 'hand' in e && e.hand === 'left');
    expect(leftEvents).toEqual([]);
  });

  it('closeFist then openFist: FistClosed then FistOpened, once each', () => {
    const { events } = run(
      script('fist', [...closeFist('right'), ...idle(300), ...openFist('right')]),
    );
    const fist = events.filter((e) => e.type === 'FistClosed' || e.type === 'FistOpened');
    expect(fist.map((e) => e.type)).toEqual(['FistClosed', 'FistOpened']);
    expect(fist.every((e) => 'hand' in e && e.hand === 'right')).toBe(true);
    expect(fist[0].t).toBeLessThan(fist[1].t);
  });

  it('underarmSwing: one underarm ThrowReleased within 50 ms of the true speed peak', () => {
    const s = script('bowl', underarmSwing('right', { power: 1 }));
    const r = releases(run(s).events);
    expect(r).toHaveLength(1);
    expect(r[0].hand).toBe('right');
    expect(r[0].style).toBe('underarm');
    expect(Math.abs(r[0].t - truePeakT(s, 'right'))).toBeLessThanOrEqual(50);
    expect(r[0].speed).toBeGreaterThan(4);
  });

  it('underarmSwing: speed rises with power', () => {
    const speeds = [0.4, 0.7, 1.0].map((power) => {
      const r = releases(run(script('bowl', underarmSwing('right', { power }))).events);
      expect(r).toHaveLength(1);
      return r[0].speed;
    });
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[2]).toBeGreaterThan(speeds[1]);
  });

  it('underarmSwing: lateral follows the lateral option', () => {
    const lateral = [-0.3, 0, 0.3].map((l) => {
      const r = releases(run(script('bowl', underarmSwing('right', { lateral: l }))).events);
      expect(r).toHaveLength(1);
      return r[0].lateral;
    });
    expect(lateral[1]).toBeGreaterThan(lateral[0] + 0.1);
    expect(lateral[2]).toBeGreaterThan(lateral[1] + 0.1);
  });

  // The synthetic swing is a straight line after a short back-swing, so what the recognizer sees
  // as curvature is the turn at the back-swing joint: a `curve` tilting the sweep toward screen
  // right turns the path more clockwise. The sign of `curve` therefore shows up as the ORDER of
  // the curvatures, not as an absolute sign.
  it('underarmSwing: curvature increases with the curve option', () => {
    const k = [-0.8, 0, 0.8].map((curve) => {
      const r = releases(run(script('bowl', underarmSwing('right', { curve }))).events);
      expect(r).toHaveLength(1);
      return r[0].curvature;
    });
    expect(k[1]).toBeGreaterThan(k[0]);
    expect(k[2]).toBeGreaterThan(k[1]);
    expect(k[2]).toBeGreaterThan(0);
  });

  it('overarmThrow: one overarm ThrowReleased; flatter loft option gives a higher loft', () => {
    const s = script('javelin', overarmThrow('right', { power: 1 }));
    const r = releases(run(s).events);
    expect(r).toHaveLength(1);
    expect(r[0].style).toBe('overarm');
    expect(Math.abs(r[0].t - truePeakT(s, 'right'))).toBeLessThanOrEqual(50);
    const lofts = [15, 35, 55].map((loftDeg) => {
      const x = releases(run(script('javelin', overarmThrow('right', { loftDeg }))).events);
      expect(x).toHaveLength(1);
      return x[0].loft;
    });
    expect(lofts[1]).toBeGreaterThan(lofts[0]);
    expect(lofts[2]).toBeGreaterThan(lofts[1]);
  });

  it('twoHandSwing: SwingStarted then SwingPeak, direction and height follow the options', () => {
    const { events } = run(script('bat', twoHandSwing()));
    const started = ofType(events, 'SwingStarted');
    const peak = ofType(events, 'SwingPeak');
    expect(started).toHaveLength(1);
    expect(peak).toHaveLength(1);
    expect(started[0].t).toBeLessThan(peak[0].t);
    expect(started[0].direction).toBe(1);
    const left = run(script('bat', twoHandSwing({ direction: -1 }))).events;
    expect(ofType(left, 'SwingStarted')).toHaveLength(1);
    expect(ofType(left, 'SwingStarted')[0].direction).toBe(-1);
    expect(ofType(left, 'SwingPeak')).toHaveLength(1);
    const heights = [-0.7, -0.35, 0.1].map((height) => {
      const e = ofType(run(script('bat', twoHandSwing({ height }))).events, 'SwingStarted');
      expect(e).toHaveLength(1);
      return e[0].height;
    });
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[2]).toBeGreaterThan(heights[1]);
  });

  it('runInPlace: 9 to 10 alternating Steps, cadence near 3 while running, 0 after', () => {
    const samples: { t: number; v: number }[] = [];
    const s = script('run', runInPlace({ steps: 10, stepsPerSecond: 3 }));
    const { events, durationMs } = runScript(s, {
      seed,
      extraMs: 2500,
      onFrame: (state, t) => samples.push({ t, v: state.cadence.stepsPerSecond }),
    });
    const steps = ofType(events, 'Step');
    expect(steps.length).toBeGreaterThanOrEqual(9);
    expect(steps.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < steps.length; i++) expect(steps[i].side).not.toBe(steps[i - 1].side);
    const running = samples.filter((x) => x.t >= 500 + 4 * 333 && x.t <= 500 + 9 * 333);
    expect(running.length).toBeGreaterThan(10);
    for (const x of running) expect(Math.abs(x.v - 3) / 3).toBeLessThan(0.15);
    const last = steps[steps.length - 1].t;
    const zero = samples.find((x) => x.t > last && x.v === 0);
    expect(zero).toBeDefined();
    expect(zero!.t - last).toBeLessThanOrEqual(1200);
    expect(durationMs).toBeGreaterThan(last);
  });

  it('runInPlace: faster running reads a higher cadence', () => {
    const mean = (sps: number): number => {
      const vals: number[] = [];
      runScript(script('run', runInPlace({ steps: 14, stepsPerSecond: sps })), {
        seed,
        onFrame: (state, t) => {
          if (t > 1800 && t < 500 + (14 * 1000) / sps - 400)
            vals.push(state.cadence.stepsPerSecond);
        },
      });
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const slow = mean(2.5);
    const fast = mean(4.5);
    expect(fast).toBeGreaterThan(slow + 0.8);
  });

  it('idle for 4 s with noise: no events at all', () => {
    expect(run(script('idle', idle(3500))).events).toEqual([]);
  });

  it('lean and sidestep: no throw, swing or punch events', () => {
    const s = script('body', [
      ...leanTo(0.3),
      ...leanTo(-0.3, 600),
      ...leanTo(0),
      ...sidestep(0.7),
      ...sidestep(0.3, 700),
      ...sidestep(0.5),
      ...idle(400),
    ]);
    const { events } = run(s);
    const bad = events.filter((e) =>
      ['ThrowWindup', 'ThrowReleased', 'SwingStarted', 'SwingPeak', 'Punch'].includes(e.type),
    );
    expect(bad).toEqual([]);
    expect(ofType(events, 'Step')).toEqual([]);
  });

  it('squat: one Squat; jumpUp: one Jump (with and without calibration)', () => {
    for (const calibration of [null, syntheticCalibration()]) {
      const sq = runScript(script('squat', squat()), { seed, extraMs: 800, calibration }).events;
      expect(ofType(sq, 'Squat')).toHaveLength(1);
      expect(ofType(sq, 'Jump')).toHaveLength(0);
      expect(ofType(sq, 'Step')).toHaveLength(0);
      expect(releases(sq)).toHaveLength(0);
      const jp = runScript(script('jump', jumpUp()), { seed, extraMs: 800, calibration }).events;
      expect(ofType(jp, 'Jump')).toHaveLength(1);
      expect(ofType(jp, 'Step')).toHaveLength(0);
      expect(ofType(jp, 'Jump')[0].height).toBeGreaterThan(0.3);
    }
  });

  it('lost demo script: TrackingLost then TrackingFound', () => {
    const lost = getScript('lost');
    expect(lost).not.toBeNull();
    const { events } = runScript(lost!, { seed, extraMs: 500 });
    const kinds = events
      .filter((e) => e.type === 'TrackingLost' || e.type === 'TrackingFound')
      .map((e) => e.type);
    expect(kinds).toEqual(['TrackingLost', 'TrackingFound']);
  });

  it('works without hand crops: arm raise still fires, no fist events', () => {
    const { events } = runScript(script('raise', raiseArm('right', { fist: true })), {
      seed,
      needs: NEEDS_NO_HANDS,
      extraMs: 600,
    });
    expect(ofType(events, 'ArmRaised')).toHaveLength(1);
    expect(ofType(events, 'FistClosed')).toHaveLength(0);
  });
});
