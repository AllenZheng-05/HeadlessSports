import { describe, expect, it } from 'vitest';
import { pitchingConfig as cfg } from './config';
import { ballAt, flightSeconds, latencyProgress } from './flight';
import { createGame, onThrow, pickTarget, pitchesFor, stepGame } from './game';
import type { GameState, HandInput, ThrowInput } from './game';

const hand = (o: Partial<HandInput> = {}): HandInput => ({
  present: true,
  known: true,
  closed: true,
  speed: 0,
  ...o,
});
const rng = (): (() => number) => {
  let s = 12345;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};
const mk = (total = 3): GameState => createGame(total, rng());
/** Step in 10 ms slices. */
const run = (g: GameState, ms: number, h: HandInput, paused = false): void => {
  for (let t = 0; t < ms; t += 10) stepGame(g, cfg, 0.01, h, paused);
};
const throwAt = (o: Partial<ThrowInput> = {}): ThrowInput => ({
  t: 0,
  hand: 'right',
  speed: 6,
  vy: 0,
  lateral: 0.62,
  curvature: 0,
  style: 'overarm',
  ...o,
});
const toWindup = (g: GameState, h = hand()): void => {
  run(g, cfg.signHoldMs + 50, h);
  run(g, cfg.throwLockoutMs + 50, h);
};

describe('sign', () => {
  it('a still closed hand picks the fastball after the hold', () => {
    const g = mk();
    run(g, cfg.signHoldMs - 50, hand());
    expect(g.phase).toBe('sign');
    expect(g.reading).toBe('fastball');
    run(g, 100, hand());
    expect(g.phase).toBe('windup');
    expect(g.kind).toBe('fastball');
    expect(g.usedFallback).toBe(false);
  });
  it('a still open hand picks the curve', () => {
    const g = mk();
    run(g, cfg.signHoldMs + 50, hand({ closed: false }));
    expect(g.phase).toBe('windup');
    expect(g.kind).toBe('curve');
  });
  it('movement resets the hold progress', () => {
    const g = mk();
    run(g, cfg.signHoldMs - 100, hand());
    run(g, 20, hand({ speed: 3 }));
    expect(g.holdMs).toBe(0);
    run(g, cfg.signHoldMs - 100, hand());
    expect(g.phase).toBe('sign');
    run(g, 200, hand());
    expect(g.phase).toBe('windup');
  });
  it('changing the reading restarts the hold', () => {
    const g = mk();
    run(g, cfg.signHoldMs - 100, hand());
    run(g, 50, hand({ closed: false }));
    expect(g.reading).toBe('curve');
    expect(g.holdMs).toBeLessThan(100);
    run(g, cfg.signHoldMs + 50, hand({ closed: false }));
    expect(g.kind).toBe('curve');
  });
  it('an unknown or missing hand falls back to the fastball after the fallback time', () => {
    for (const h of [hand({ known: false }), hand({ present: false })]) {
      const g = mk();
      run(g, cfg.signHoldMs + 500, h);
      expect(g.phase).toBe('sign');
      run(g, cfg.signFallbackMs, h);
      expect(g.phase).toBe('windup');
      expect(g.kind).toBe('fastball');
      expect(g.usedFallback).toBe(true);
    }
  });
});

describe('windup and throws', () => {
  it('ignores throws during the lockout and takes the first valid one after', () => {
    const g = mk();
    run(g, cfg.signHoldMs + 50, hand());
    expect(g.phase).toBe('windup');
    expect(onThrow(g, cfg, 1000, throwAt(), 'right', false)).toBe('lockout');
    run(g, cfg.throwLockoutMs + 20, hand());
    expect(onThrow(g, cfg, 1000, throwAt({ speed: 1 }), 'right', false)).toBe('slow');
    expect(onThrow(g, cfg, 1000, throwAt(), 'right', false)).toBe('taken');
    expect(g.phase).toBe('flight');
    expect(g.releaseSeq).toBe(1);
    expect(onThrow(g, cfg, 1001, throwAt(), 'right', false)).toBe('phase');
  });
  it('ignores the wrong hand and counts it', () => {
    const g = mk();
    toWindup(g);
    expect(onThrow(g, cfg, 1000, throwAt({ hand: 'left' }), 'right', false)).toBe('wrong-hand');
    expect(g.phase).toBe('windup');
    expect(g.ignored.wrongHand).toBe(1);
  });
  it('ignores throws in sign, flight and result', () => {
    const g = mk();
    expect(onThrow(g, cfg, 0, throwAt(), 'right', false)).toBe('phase');
    toWindup(g);
    onThrow(g, cfg, 0, throwAt(), 'right', false);
    expect(onThrow(g, cfg, 0, throwAt(), 'right', false)).toBe('phase');
    run(g, g.flightMs + 50, hand({ speed: 5 }));
    expect(g.phase).toBe('result');
    expect(onThrow(g, cfg, 0, throwAt(), 'right', false)).toBe('phase');
    expect(g.ignored.phase).toBe(3);
  });
  it('can reject underarm throws when asked', () => {
    const g = mk();
    toWindup(g);
    const strict = { ...cfg, acceptAnyStyle: false };
    expect(onThrow(g, strict, 0, throwAt({ style: 'underarm' }), 'right', false)).toBe('style');
    expect(onThrow(g, cfg, 0, throwAt({ style: 'underarm' }), 'right', false)).toBe('taken');
  });
  it('a balk follows the pitch clock and scores nothing', () => {
    const g = mk();
    toWindup(g);
    run(g, cfg.pitchClockS * 1000 - 600, hand());
    expect(g.phase).toBe('windup');
    run(g, 1000, hand());
    expect(g.phase).toBe('result');
    expect(g.balk).toBe(true);
    expect(g.records[0]!.score.points).toBe(0);
    expect(g.records[0]!.balk).toBe(true);
  });
  it('never picks the same cell twice in a row', () => {
    const r = rng();
    let last = -1;
    for (let i = 0; i < 500; i++) {
      const c = pickTarget(r, last);
      expect(c).not.toBe(last);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(9);
      last = c;
    }
  });
});

describe('the round', () => {
  it('plays the pitch count, finishes once, then stays done', () => {
    const g = mk(2);
    for (let p = 0; p < 2; p++) {
      expect(g.phase).toBe('sign');
      toWindup(g);
      expect(onThrow(g, cfg, 0, throwAt(), 'right', false)).toBe('taken');
      run(g, g.flightMs + cfg.betweenPitchesMs + 100, hand({ speed: 5 }));
    }
    expect(g.phase).toBe('done');
    expect(g.records).toHaveLength(2);
    expect(g.doneSeq).toBe(1);
    run(g, 5000, hand({ speed: 5 }));
    expect(g.doneSeq).toBe(1);
    expect(g.nextSeq).toBe(1);
  });
  it('a short round uses the short count', () => {
    expect(pitchesFor(cfg, true)).toBe(3);
    expect(pitchesFor(cfg, false)).toBe(10);
  });
  it('acts on nothing while paused', () => {
    const g = mk();
    run(g, 5000, hand(), true);
    expect(g.phase).toBe('sign');
    expect(g.holdMs).toBe(0);
    toWindup(g);
    run(g, 20000, hand(), true);
    expect(g.phase).toBe('windup');
    const wm = g.windupMs;
    run(g, 1000, hand(), true);
    expect(g.windupMs).toBe(wm);
    expect(onThrow(g, cfg, 0, throwAt(), 'right', true)).toBe('paused');
    expect(g.phase).toBe('windup');
    onThrow(g, cfg, 0, throwAt(), 'right', false);
    const el = g.flightElapsedMs;
    run(g, 1000, hand(), true);
    expect(g.flightElapsedMs).toBe(el);
  });
  it('the latency start never puts the ball past half way', () => {
    const g = mk();
    toWindup(g);
    onThrow(g, cfg, 5000, throwAt({ t: 4000 }), 'right', false);
    expect(g.flightElapsedMs / g.flightMs).toBeCloseTo(cfg.maxLatencyFraction, 6);
  });
});

describe('flight helpers', () => {
  it('latency progress scales with the delay and clamps', () => {
    expect(latencyProgress(cfg, 1000, 1000, 800)).toBe(0);
    expect(latencyProgress(cfg, 1200, 1000, 800)).toBeCloseTo(0.25, 9);
    expect(latencyProgress(cfg, 3000, 1000, 800)).toBe(cfg.maxLatencyFraction);
    expect(latencyProgress(cfg, 900, 1000, 800)).toBe(0);
  });
  it('faster pitches arrive sooner', () => {
    expect(flightSeconds(cfg, 120)).toBeLessThan(flightSeconds(cfg, 60));
  });
  it('the ball leaves and arrives exactly, and a curve is displaced between', () => {
    const from = { x: 0.3, y: 1.8, z: 0 };
    const to = { x: -0.1, y: 0.8, z: -14 };
    const out = { x: 0, y: 0, z: 0 };
    ballAt(cfg, from, to, 0, true, -0.12, -0.22, out);
    expect(out.x).toBeCloseTo(0.3, 9);
    expect(out.y).toBeCloseTo(1.8, 9);
    ballAt(cfg, from, to, 1, true, -0.12, -0.22, out);
    expect(out.x).toBeCloseTo(-0.1, 9);
    expect(out.y).toBeCloseTo(0.8, 9);
    const straight = { x: 0, y: 0, z: 0 };
    ballAt(cfg, from, to, 0.5, false, 0, 0, straight);
    ballAt(cfg, from, to, 0.5, true, -0.12, -0.22, out);
    expect(out.y).toBeGreaterThan(straight.y);
    expect(out.x).toBeGreaterThan(straight.x);
  });
});
