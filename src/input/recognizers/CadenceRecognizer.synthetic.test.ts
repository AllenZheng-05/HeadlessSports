// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// Running in place end to end: synthetic player -> filters -> kinematics -> recognizers, with
// noise on, over several seeds. The jog is the front-view move (small knee displacement, arm
// pump, torso bob); the other moves must not look like running.
import { describe, expect, it } from 'vitest';
import type { Script, ScriptStep } from '../../tracking/synthetic/script';
import {
  idle,
  jogInPlace,
  jumpUp,
  overarmThrow,
  raiseArm,
  sidestep,
  squat,
} from '../../tracking/synthetic/scripts/moves';
import { ofType } from '../testing/collect';
import { runScript } from '../testing/runScript';

const SEEDS = [1, 2, 3, 4, 5];
const LEAD_MS = 600;

function script(name: string, steps: ScriptStep[]): Script {
  return { name, steps: [...idle(LEAD_MS), ...steps] };
}

/** Cadence over time, and the first time it was above 0. */
function trace(s: Script, seed: number, extraMs = 800) {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let peakRate = 0;
  const { events } = runScript(s, {
    seed,
    extraMs,
    needs: { pose: true, handCrops: false, fullFrameHands: false },
    onFrame: (state, t) => {
      const r = state.cadence.stepsPerSecond;
      if (r > 0) {
        first = Math.min(first, t);
        last = t;
        peakRate = Math.max(peakRate, r);
      }
    },
  });
  return { events, first, last, peakRate };
}

describe.each(SEEDS)('running in place on synthetic moves, noise seed %i', (seed) => {
  // The first 250 ms of a jog is the arms moving to the running position.
  const START = LEAD_MS + 250;
  const jog = (o: Parameters<typeof jogInPlace>[0]) => script('jog', jogInPlace(o));

  it('front-view jog at 3 steps/s: starts under a second in, 3 steps/s, stops soon after', () => {
    const r = trace(jog({ steps: 18, stepsPerSecond: 3 }), seed);
    expect(r.first - START).toBeLessThan(900);
    expect(Math.abs(r.peakRate - 3) / 3).toBeLessThan(0.15);
    const steps = ofType(r.events, 'Step');
    expect(steps.length).toBeGreaterThanOrEqual(14);
    expect(steps.length).toBeLessThanOrEqual(20);
    // Stops within about 600 ms of the last step (18 steps end at START + 6000).
    expect(r.last - (START + 6000)).toBeLessThan(700);
  });

  it('faster and slower jogs give faster and slower rates', () => {
    const slow = trace(jog({ steps: 12, stepsPerSecond: 2.2 }), seed);
    const fast = trace(jog({ steps: 20, stepsPerSecond: 4.4 }), seed);
    expect(slow.peakRate).toBeGreaterThan(1.9);
    expect(slow.peakRate).toBeLessThan(2.6);
    expect(fast.peakRate).toBeGreaterThan(3.9);
    expect(fast.peakRate).toBeLessThan(5.01);
  });

  it('arm pump alone (legs and torso still)', () => {
    const r = trace(jog({ steps: 18, stepsPerSecond: 3, kneeLift: 0, bob: 0 }), seed);
    expect(r.first - START).toBeLessThan(1500);
    expect(Math.abs(r.peakRate - 3) / 3).toBeLessThan(0.15);
  });

  it('legs alone (arms and torso still)', () => {
    const r = trace(jog({ steps: 18, stepsPerSecond: 3, armPump: 0, bob: 0 }), seed);
    expect(r.first - START).toBeLessThan(1500);
    expect(Math.abs(r.peakRate - 3) / 3).toBeLessThan(0.15);
  });

  it('javelin arm held up: the other arm and the legs carry it', () => {
    const r = trace(
      script('hold', [
        ...jogInPlace({ steps: 0, stepsPerSecond: 3, hold: 'right' }).slice(0, 1),
        ...idle(400),
        ...jogInPlace({ steps: 18, stepsPerSecond: 3, hold: 'right' }).slice(1),
      ]),
      seed,
    );
    expect(r.peakRate).toBeGreaterThan(2.6);
    expect(r.peakRate).toBeLessThan(3.4);
  });

  it('javelin arm held up, legs still: the other arm and the torso carry it', () => {
    const r = trace(
      script('hold arm', [
        ...jogInPlace({ steps: 0, stepsPerSecond: 3, hold: 'right' }).slice(0, 1),
        ...idle(400),
        ...jogInPlace({ steps: 18, stepsPerSecond: 3, hold: 'right', kneeLift: 0 }).slice(1),
      ]),
      seed,
    );
    expect(r.peakRate).toBeGreaterThan(2.6);
    expect(r.peakRate).toBeLessThan(3.4);
  });

  it.each([
    ['standing', idle(20000)],
    ['an overarm throw', overarmThrow('right', { power: 1 })],
    ['a weak overarm throw', overarmThrow('right', { power: 0.4 })],
    ['a left-handed throw', overarmThrow('left', { power: 0.8 })],
    ['one arm raised and lowered', raiseArm('right')],
    ['a squat', squat()],
    ['a jump', jumpUp()],
    ['a sidestep', [...sidestep(0.65), ...idle(500), ...sidestep(0.5)]],
  ])('%s is not running', (_name, steps) => {
    const r = trace(script('none', steps), seed, 1500);
    expect(ofType(r.events, 'Step')).toHaveLength(0);
    expect(r.peakRate).toBe(0);
  });

  it('a throw during the run: the pumping stops the run, the throw is not a step', () => {
    const r = trace(
      script('run then throw', [
        ...jogInPlace({ steps: 14, stepsPerSecond: 3.5, hold: 'right' }).slice(0, -1),
        ...overarmThrow('right', { power: 1 }),
      ]),
      seed,
      1000,
    );
    const steps = ofType(r.events, 'Step');
    // Nothing is counted once the throw is under way (the run ends at START + 4000).
    for (const s of steps) expect(s.t).toBeLessThan(LEAD_MS + 250 + 4000 + 700);
  });
});
