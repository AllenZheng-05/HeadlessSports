import { describe, expect, it } from 'vitest';
import { runScript } from '../../input/testing/runScript';
import type { GameEvent, Side } from '../../input/types';
import type { Script } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { gloveReach } from '../../tracking/synthetic/scripts/pitching';
import { createAim, createLiveInput, gloveSide, steerOffset, trackedLive } from './aim';
import { LiveAim } from './liveAim';
import type { PitchKind } from './aim';
import { botGloveTarget, botThrowOptions } from './bot';
import { pitchingConfig as cfg } from './config';
import { cellAt, cellCentre } from './zone';

type Throw = Extract<GameEvent, { type: 'ThrowReleased' }>;

/** The exact moves the bot plays for one pitch: show the sign, hold still, throw. */
function pitch(
  hand: Side,
  seed: number,
  opts: { power?: number; loftDeg?: number; lateral?: number },
  fist = true,
): Throw[] {
  const script: Script = {
    name: 'pitch-seq',
    steps: [
      ...idle(600),
      ...(fist ? closeFist(hand, 250) : openFist(hand, 250)),
      ...idle(900),
      ...overarmThrow(hand, opts),
      ...idle(400),
    ],
  };
  const run = runScript(script, { seed });
  return run.events.filter((e): e is Throw => e.type === 'ThrowReleased');
}

describe('sign then overarm throw through the real recognizers', () => {
  for (const hand of ['right', 'left'] as const) {
    it(`${hand} hand: exactly one overarm throw over seeds 1 to 5`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const t = pitch(hand, seed, { power: 0.7, loftDeg: 85 });
        expect(t).toHaveLength(1);
        expect(t[0]!.hand).toBe(hand);
        expect(t[0]!.style).toBe('overarm');
        expect(t[0]!.speed).toBeGreaterThanOrEqual(cfg.minThrowSpeed);
      }
    });
  }
  it('an open hand sign also gives exactly one throw', () => {
    for (let seed = 1; seed <= 5; seed++)
      expect(pitch('right', seed, { power: 0.7 }, false)).toHaveLength(1);
  });
});

describe('measured proxy and lateral orderings (the bot fit)', () => {
  const proxy = (e: Throw): number => e.vy / e.speed;
  it('a higher loftDeg gives a larger vy / speed, and the config range brackets 60 to 110', () => {
    for (const hand of ['right', 'left'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const lo = proxy(pitch(hand, seed, { power: 0.7, loftDeg: cfg.botLoftLow })[0]!);
        const hi = proxy(pitch(hand, seed, { power: 0.7, loftDeg: cfg.botLoftHigh })[0]!);
        expect(hi).toBeGreaterThan(lo);
        expect(Math.abs(lo - cfg.proxyLow)).toBeLessThan(0.2);
        expect(Math.abs(hi - cfg.proxyHigh)).toBeLessThan(0.2);
      }
    }
  });
  it('a larger lateral option gives a larger event.lateral', () => {
    for (const hand of ['right', 'left'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const a = pitch(hand, seed, { power: 0.7, loftDeg: 85, lateral: -0.3 })[0]!;
        const b = pitch(hand, seed, { power: 0.7, loftDeg: 85, lateral: 0.3 })[0]!;
        expect(b.lateral).toBeGreaterThan(a.lateral + 0.3);
      }
    }
  });
});

/**
 * One full camera pitch through the real recognizers: show the sign, point the glove at the cell,
 * hold, throw (optionally tucking the glove away during the throw). Returns the ring's locked base
 * aim at the release, the steering, and the event.
 */
function fullPitch(
  hand: Side,
  kind: PitchKind,
  cell: number,
  opts: { tuck?: boolean; steps?: number; lateral?: number; loftDeg?: number } = {},
): {
  base: ReturnType<typeof createAim>;
  ring: LiveAim;
  e: Throw;
  steer: { x: number; y: number };
  /** One entry per camera frame: time, whether the ring was held, the live aim and the glove input. */
  trace: { t: number; locked: boolean; x: number; y: number; gx: number; gy: number }[];
} {
  const glove = gloveSide(hand);
  const g = botGloveTarget(cfg, hand, cell, kind);
  const throwOpts = botThrowOptions(cfg, hand, 0.7);
  if (opts.lateral !== undefined) throwOpts.lateral = opts.lateral;
  if (opts.loftDeg !== undefined) throwOpts.loftDeg = opts.loftDeg;
  let throwSteps = overarmThrow(hand, throwOpts);
  if (opts.tuck) {
    // The glove arm swings across and down while the throwing arm accelerates.
    const tuck =
      glove === 'left'
        ? { leftWristX: 0.5, leftWristY: -1.2 }
        : { rightWristX: -0.5, rightWristY: -1.2 };
    throwSteps = throwSteps.map((st) =>
      st.label === 'throw' || st.label === 'follow'
        ? { ...st, to: st.to === undefined ? undefined : { ...st.to, ...tuck } }
        : st,
    );
  }
  const script: Script = {
    name: 'full-pitch',
    steps: [
      ...idle(600),
      ...(kind === 'fastball' ? closeFist(hand, 250) : openFist(hand, 250)),
      ...gloveReach(glove, g.x, g.y, 700),
      ...idle(900),
      ...throwSteps,
      ...idle(400),
    ],
  };
  const la = new LiveAim();
  const li = createLiveInput();
  const scratch = { x: 0, y: 0 };
  let lastT = -1;
  const trace: { t: number; locked: boolean; x: number; y: number; gx: number; gy: number }[] = [];
  const run = runScript(script, {
    seed: 3,
    onFrame: (state) => {
      if (state.t === lastT) return;
      lastT = state.t;
      trackedLive(cfg, state.arms[glove], state.arms[hand].speed, hand, true, li, scratch);
      la.update(cfg, state.t, li, hand, kind, cell, scratch);
      trace.push({
        t: state.t,
        locked: la.locked,
        x: la.aim.x,
        y: la.aim.y,
        gx: li.baseX,
        gy: li.baseY,
      });
    },
  });
  const e = run.events.find((x): x is Throw => x.type === 'ThrowReleased' && x.hand === hand)!;
  const base = createAim();
  la.forRelease(cfg, e.t, true, base);
  const steer = steerOffset(cfg, e, hand, false, { x: 0, y: 0 });
  return { base, ring: la, e, steer: { x: steer.x, y: steer.y }, trace };
}

describe('the glove-led bot lands near the target', () => {
  it('puts most pitches in the lit cell or beside it, for both hands and both pitches', () => {
    let within = 0;
    let total = 0;
    let sumMiss = 0;
    const p = { x: 0, y: 0 };
    for (const hand of ['right', 'left'] as const) {
      for (const kind of ['fastball', 'curve'] as PitchKind[]) {
        for (let cell = 0; cell < 9; cell++) {
          const r = fullPitch(hand, kind, cell);
          const x = r.base.x + r.steer.x * (1 - cfg.assist);
          const y = r.base.y + r.steer.y * (1 - cfg.assist);
          cellCentre(cfg, cell, p);
          sumMiss += Math.hypot(x - p.x, y - p.y);
          total++;
          if (cellAt(cfg, x, y) >= 0) within++;
        }
      }
    }
    expect(within / total).toBeGreaterThan(0.6);
    expect(sumMiss / total).toBeLessThan(0.3);
  });
});

describe('the locked ring through the real recognizers', () => {
  it('the glove tucking away during the throw does not move the pitch', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const cell of [0, 4, 8]) {
        const still = fullPitch(hand, 'fastball', cell);
        const tucked = fullPitch(hand, 'fastball', cell, { tuck: true });
        expect(Math.abs(tucked.base.x - still.base.x)).toBeLessThan(0.08);
        expect(Math.abs(tucked.base.y - still.base.y)).toBeLessThan(0.08);
        // And it is where the glove pointed: the ring was locked before the glove left.
        const p = { x: 0, y: 0 };
        cellCentre(cfg, cell, p);
        expect(Math.hypot(tucked.base.x - p.x, tucked.base.y - p.y)).toBeLessThan(0.3);
      }
    }
  });
  it('the ring is held while the throw happens, and a plain throw steers very little', () => {
    const r = fullPitch('right', 'fastball', 4, { tuck: true });
    // From the throw's onset (the last run of held frames) to the release the live aim must not
    // move, while the glove does.
    const upTo = r.trace.filter((f) => f.t <= r.e.t);
    let first = upTo.length;
    while (first > 0 && upTo[first - 1]!.locked) first--;
    const window = upTo.slice(first);
    expect(window.length).toBeGreaterThan(1);
    expect(window.every((f) => f.locked)).toBe(true);
    const base = window[0]!;
    let aimDrift = 0;
    let gloveTravel = 0;
    for (const f of window) {
      aimDrift = Math.max(aimDrift, Math.abs(f.x - base.x), Math.abs(f.y - base.y));
      gloveTravel = Math.max(gloveTravel, Math.abs(f.gx - base.gx), Math.abs(f.gy - base.gy));
    }
    expect(gloveTravel).toBeGreaterThan(0.05);
    expect(aimDrift).toBe(0);
    expect(Math.abs(r.steer.x)).toBeLessThanOrEqual(cfg.steerMaxX);
    expect(Math.abs(r.steer.y)).toBeLessThanOrEqual(cfg.steerMaxY);
  });
  it('a pulled release nudges the pitch toward the pull, within the clamp', () => {
    for (const hand of ['right', 'left'] as const) {
      const lo = fullPitch(hand, 'fastball', 4, { loftDeg: cfg.botLoftLow });
      const hi = fullPitch(hand, 'fastball', 4, { loftDeg: cfg.botLoftHigh });
      expect(hi.steer.y).toBeGreaterThan(lo.steer.y);
      const a = fullPitch(hand, 'fastball', 4, { lateral: -0.3 });
      const b = fullPitch(hand, 'fastball', 4, { lateral: 0.3 });
      expect(b.steer.x).toBeGreaterThan(a.steer.x);
    }
  });
});
