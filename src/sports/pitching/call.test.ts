import { describe, expect, it } from 'vitest';
import { callText, locationPhrase, reactionText } from './call';
import { pitchingConfig as cfg } from './config';
import { createGame, onThrow, startCall, stepGame } from './game';
import type { GameState, HandInput, ThrowInput } from './game';

const hand = (o: Partial<HandInput> = {}): HandInput => ({
  present: true,
  known: true,
  closed: true,
  speed: 0,
  ...o,
});
const lcg = (seed: number): (() => number) => {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
};
const run = (g: GameState, ms: number, h: HandInput): void => {
  for (let t = 0; t < ms; t += 10) stepGame(g, cfg, 0.01, h, false);
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
const skipCall = (g: GameState): void =>
  run(g, cfg.callSetupMs + cfg.callReactMs + 20, hand({ speed: 3 }));
const toWindup = (g: GameState, h: HandInput): void => {
  run(g, cfg.signHoldMs + 50, h);
  run(g, cfg.throwLockoutMs + 50, h);
};

describe('the words of the call', () => {
  it('names the pitch and the spot', () => {
    expect(callText('fastball', 0)).toBe('Fastball, high and left');
    expect(callText('curve', 8)).toBe('Curve, low and right');
    expect(locationPhrase(4)).toBe('down the middle');
    expect(locationPhrase(1)).toBe('high in the middle');
    expect(locationPhrase(3)).toBe('left side');
    expect(locationPhrase(5)).toBe('right side');
    expect(locationPhrase(7)).toBe('low in the middle');
  });
  it('the catcher reacts to a match, a mismatch and a balk', () => {
    expect(reactionText(true, false)).toBe('Nice');
    expect(reactionText(false, false)).toBe('Not what I called');
    expect(reactionText(false, true)).not.toBe('Not what I called');
    expect(reactionText(true, false, false)).not.toBe('Nice');
  });
});

describe('the catcher calls the pitch', () => {
  it('the same seed gives the same calls, a different seed a different run', () => {
    const calls = (seed: number): string => {
      const g = createGame(10, lcg(seed));
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        out.push(`${g.called}${g.target}`);
        startCall(g, cfg.curveShare);
      }
      return out.join(',');
    };
    expect(calls(7)).toBe(calls(7));
    expect(calls(7)).not.toBe(calls(8));
  });
  it('calls both pitches over a long run, and never the same spot twice running', () => {
    const g = createGame(10, lcg(3));
    const seen = new Set<string>();
    let last = g.target;
    for (let i = 0; i < 60; i++) {
      startCall(g, cfg.curveShare);
      seen.add(g.called);
      expect(g.target).not.toBe(last);
      last = g.target;
    }
    expect(seen.size).toBe(2);
  });
});

describe('the rhythm of a pitch', () => {
  it('setup, then the bubble, then a clear window, then sign', () => {
    const g = createGame(3, lcg(1));
    expect(g.phase).toBe('call');
    expect(g.bubbleOn).toBe(false);
    run(g, cfg.callSetupMs - 50, hand());
    expect(g.bubbleOn).toBe(false);
    run(g, 100, hand());
    expect(g.bubbleOn).toBe(true);
    expect(g.revealSeq).toBe(1);
    // A hand that already shows a still fist selects nothing while the call is being read.
    run(g, cfg.callReactMs - 200, hand());
    expect(g.phase).toBe('call');
    expect(g.selectSeq).toBe(0);
    run(g, 250, hand());
    expect(g.phase).toBe('sign');
    expect(g.bubbleOn).toBe(true);
    expect(cfg.callReactMs).toBeGreaterThanOrEqual(2000);
  });
  it('the player is never rushed', () => {
    const g = createGame(3, lcg(1));
    skipCall(g);
    run(g, 15000, hand({ speed: 3 }));
    expect(g.phase).toBe('sign');
    expect(cfg.pitchClockS).toBeGreaterThanOrEqual(15);
    expect(cfg.signFallbackMs).toBeGreaterThanOrEqual(4000);
  });
  it('the bubble stays up through sign and wind-up and goes at the release', () => {
    const g = createGame(3, lcg(1));
    skipCall(g);
    expect(g.bubbleOn).toBe(true);
    toWindup(g, hand());
    expect(g.phase).toBe('windup');
    expect(g.bubbleOn).toBe(true);
    expect(onThrow(g, cfg, 0, throwAt(), 'right', false)).toBe('taken');
    expect(g.bubbleOn).toBe(false);
  });
  it('the first pitch gets a longer beat; later pitches do not', () => {
    const g = createGame(3, lcg(1), false, 1, cfg.firstPitchExtraMs);
    run(g, cfg.callSetupMs + 100, hand());
    expect(g.bubbleOn).toBe(false);
    run(g, cfg.firstPitchExtraMs, hand());
    expect(g.bubbleOn).toBe(true);
    run(g, cfg.callReactMs + 50, hand({ speed: 3 }));
    expect(g.phase).toBe('sign');
    toWindup(g, hand());
    onThrow(g, cfg, 0, throwAt(), 'right', false);
    run(g, g.flightMs + cfg.betweenPitchesMs + 100, hand({ speed: 5 }));
    expect(g.phase).toBe('call');
    run(g, cfg.callSetupMs + 50, hand({ speed: 5 }));
    expect(g.bubbleOn).toBe(true);
  });
  it('the result is shown for a beat before the next call starts', () => {
    const g = createGame(3, lcg(1));
    skipCall(g);
    toWindup(g, hand());
    onThrow(g, cfg, 0, throwAt(), 'right', false);
    run(g, g.flightMs + 20, hand({ speed: 5 }));
    expect(g.phase).toBe('result');
    run(g, cfg.betweenPitchesMs - 100, hand({ speed: 5 }));
    expect(g.phase).toBe('result');
    run(g, 200, hand({ speed: 5 }));
    expect(g.phase).toBe('call');
    expect(g.callSeq).toBe(2);
  });
  it('a short round shortens every gap by the gap scale', () => {
    const g = createGame(3, lcg(1), false, cfg.shortGapScale, cfg.firstPitchExtraMs);
    run(g, (cfg.callSetupMs + cfg.firstPitchExtraMs) * cfg.shortGapScale + 30, hand());
    expect(g.bubbleOn).toBe(true);
    run(g, cfg.callReactMs * cfg.shortGapScale + 30, hand({ speed: 3 }));
    expect(g.phase).toBe('sign');
  });
});

describe('the call is scored', () => {
  it('records whether the pitch thrown was the one called', () => {
    for (const same of [true, false]) {
      const g = createGame(3, lcg(5));
      skipCall(g);
      const wantFist = same ? g.called === 'fastball' : g.called !== 'fastball';
      toWindup(g, hand({ closed: wantFist }));
      expect(g.kind === g.called).toBe(same);
      onThrow(g, cfg, 0, throwAt(), 'right', false);
      expect(g.score.matched).toBe(same);
    }
  });
  it('a throw is scored where the live indicator pointed, not from the event', () => {
    const g = createGame(3, lcg(1));
    skipCall(g);
    toWindup(g, hand());
    const live = { rawX: 0.1, rawY: 0.9, x: 0.05, y: 0.85, kmh: 0, scoredKmh: 0 };
    onThrow(g, cfg, 0, throwAt({ lateral: 1.4, vy: 5 }), 'right', false, live);
    expect(g.aim.x).toBe(0.05);
    expect(g.aim.y).toBe(0.85);
    expect(g.aim.rawX).toBe(0.1);
    // Speed still comes from the throw.
    expect(g.aim.kmh).toBeGreaterThan(0);
  });
});
