import { describe, expect, it } from 'vitest';
import { javelinConfig } from './config';
import {
  attemptLine,
  attemptsFor,
  createGame,
  distanceToLine,
  onArmLowered,
  onArmRaised,
  onFistClosed,
  onThrow,
  stepGame,
} from './game';
import type { GameState, ThrowInput } from './game';

const cfg = { ...javelinConfig };
const DT = 1 / 120;

/** Run the rules for `seconds` of game time, returning the new clock. */
function run(s: GameState, now: number, seconds: number, sps = 4, amp = 0.45): number {
  const n = Math.round(seconds * 120);
  let t = now;
  for (let i = 0; i < n; i++) {
    t += DT * 1000;
    stepGame(s, cfg, DT, t, sps, amp);
  }
  return t;
}

const throwAt = (t: number, over: Partial<ThrowInput> = {}): ThrowInput => ({
  t,
  hand: 'right',
  speed: 8,
  vy: 2,
  style: 'overarm',
  ...over,
});

function started(): { s: GameState; now: number } {
  const s = createGame(3);
  onArmRaised(s, cfg, 1000, 'right', false, 'closed', 'right');
  return { s, now: 1000 };
}

describe('start gesture', () => {
  it('starts on a raised throwing arm with a closed fist', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 100, 'right', false, 'closed', 'right');
    expect(s.phase).toBe('run');
    expect(s.startSeq).toBe(1);
  });
  it('starts when the hand state is not known (crops are unreliable at distance)', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 100, 'right', false, 'unknown', 'right');
    expect(s.phase).toBe('run');
  });
  it('starts when both arms are up, whatever the fists say', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 100, 'left', true, 'open', 'right');
    expect(s.phase).toBe('run');
  });
  it('does not start from the other arm alone, closed or not', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 100, 'left', false, 'closed', 'right');
    onArmRaised(s, cfg, 100, 'left', false, 'unknown', 'right');
    expect(s.phase).toBe('ready');
  });
  it('a known open hand starts only after the hold, or when the fist closes', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 1000, 'right', false, 'open', 'right');
    expect(s.phase).toBe('ready');
    const t = run(s, 1000, 0.3);
    expect(s.phase).toBe('ready');
    run(s, t, 0.4);
    expect(s.phase).toBe('run');

    const s2 = createGame(3);
    onArmRaised(s2, cfg, 1000, 'right', false, 'open', 'right');
    onFistClosed(s2, cfg, 1200, 'right', 'right');
    expect(s2.phase).toBe('run');
  });
  it('lowering the arm before the hold cancels it, and a fist with the arm down does nothing', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 1000, 'right', false, 'open', 'right');
    onArmLowered(s, cfg, 1200, 'right', 'right');
    run(s, 1200, 1.5);
    expect(s.phase).toBe('ready');
    onFistClosed(s, cfg, 3000, 'right', 'right');
    expect(s.phase).toBe('ready');
  });
  it('ignores a closed fist of the wrong hand', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 1000, 'right', false, 'open', 'right');
    onFistClosed(s, cfg, 1100, 'left', 'right');
    expect(s.phase).toBe('ready');
  });
  it('left-handed play uses the left arm', () => {
    const s = createGame(3);
    onArmRaised(s, cfg, 100, 'right', false, 'closed', 'left');
    expect(s.phase).toBe('ready');
    onArmRaised(s, cfg, 100, 'left', false, 'closed', 'left');
    expect(s.phase).toBe('run');
  });
});

describe('throws', () => {
  it('are ignored in ready', () => {
    const s = createGame(3);
    expect(onThrow(s, cfg, 500, throwAt(500), 'right')).toBe(false);
    expect(s.phase).toBe('ready');
  });
  it('are ignored during the lockout and accepted after it', () => {
    const { s, now } = started();
    expect(onThrow(s, cfg, now + 100, throwAt(now + 80), 'right')).toBe(false);
    expect(s.phase).toBe('run');
    const t = run(s, now, 1);
    expect(onThrow(s, cfg, t, throwAt(t), 'right')).toBe(true);
    expect(s.phase).toBe('flight');
  });
  it('lowering the start arm shortly after starting extends the lockout', () => {
    const { s, now } = started();
    const t = run(s, now, 0.4);
    onArmLowered(s, cfg, t, 'right', 'right');
    expect(onThrow(s, cfg, t + 450, throwAt(t + 450), 'right')).toBe(false);
    expect(onThrow(s, cfg, t + 600, throwAt(t + 600), 'right')).toBe(true);
  });
  it('lowering the arm much later does not lock anything out', () => {
    const { s, now } = started();
    const t = run(s, now, 4);
    onArmLowered(s, cfg, t, 'right', 'right');
    expect(onThrow(s, cfg, t + 10, throwAt(t + 10), 'right')).toBe(true);
  });
  it('need the throwing hand, the speed floor and (optionally) an overarm style', () => {
    const { s, now } = started();
    const t = run(s, now, 1);
    expect(onThrow(s, cfg, t, throwAt(t, { hand: 'left' }), 'right')).toBe(false);
    expect(onThrow(s, cfg, t, throwAt(t, { speed: 1 }), 'right')).toBe(false);
    cfg.acceptAnyStyle = false;
    expect(onThrow(s, cfg, t, throwAt(t, { style: 'underarm' }), 'right')).toBe(false);
    cfg.acceptAnyStyle = true;
    expect(onThrow(s, cfg, t, throwAt(t, { style: 'underarm' }), 'right')).toBe(true);
  });
  it('a valid throw lands, scores the distance from the line and records the release', () => {
    const { s, now } = started();
    const t = run(s, now, 2.2);
    expect(s.speed).toBeGreaterThan(5);
    expect(s.position).toBeLessThan(cfg.runwayLength - 3);
    expect(onThrow(s, cfg, t, throwAt(t), 'right')).toBe(true);
    run(s, t, 5);
    expect(s.phase).toBe('result');
    expect(s.records).toHaveLength(1);
    const r = s.records[0]!;
    expect(r.foul).toBe(false);
    expect(r.distance).toBeGreaterThan(20);
    expect(r.lineGap).toBeGreaterThan(0);
    expect(s.best).toBe(r.distance);
    expect(s.landSeq).toBe(1);
    expect(s.flight.x - cfg.runwayLength).toBeCloseTo(r.distance, 6);
  });
  it('step the release point back by speed times the delay', () => {
    const a = started();
    const t = run(a.s, a.now, 2);
    const b = started();
    run(b.s, b.now, 2);
    const speed = a.s.speed;
    onThrow(a.s, cfg, t, throwAt(t), 'right');
    onThrow(b.s, cfg, t, throwAt(t - 100), 'right');
    expect(a.s.release.x - b.s.release.x).toBeCloseTo(speed * 0.1, 6);
  });
  it('latency compensation keeps a throw just before the line from being a foul', () => {
    const { s, now } = started();
    let t = run(s, now, 3.4);
    // Run until the athlete is 0.2 m past the line, but the release happened 150 ms earlier.
    while (distanceToLine(s, cfg) > -0.1) t = run(s, t, 0.01);
    expect(s.phase).toBe('run');
    const released = t - 150;
    expect(onThrow(s, cfg, t, throwAt(released), 'right')).toBe(true);
    expect(s.release.lineGap).toBeGreaterThan(0);
    expect(s.flightFoul).toBe(false);
  });
  it('a throw released beyond the line is a foul that scores nothing', () => {
    const { s, now } = started();
    let t = run(s, now, 3.4);
    while (distanceToLine(s, cfg) > -0.1) t = run(s, t, 0.01);
    expect(onThrow(s, cfg, t, throwAt(t), 'right')).toBe(true);
    expect(s.flightFoul).toBe(true);
    run(s, t, 8);
    expect(s.records[0]!.foul).toBe(true);
    expect(s.records[0]!.distance).toBe(0);
    expect(s.best).toBe(0);
  });
});

describe('crossing the line', () => {
  it('without a throw is a foul', () => {
    const { s, now } = started();
    let t = now;
    let guard = 0;
    while (s.phase === 'run' && guard++ < 4000) t = run(s, t, 0.05);
    expect(s.phase).toBe('flight');
    expect(s.position).toBeGreaterThanOrEqual(cfg.runwayLength + cfg.overrun);
    run(s, t, 3);
    expect(s.phase).toBe('result');
    expect(s.records[0]).toMatchObject({ foul: true, distance: 0, why: 'crossed' });
  });
  it('waits for a late throw event: released before the line, reported after crossing', () => {
    const { s, now } = started();
    let t = now;
    let guard = 0;
    // Run until the athlete is past line plus overrun, but inside the grace window.
    while (s.crossT === 0 && guard++ < 4000) t = run(s, t, 0.01);
    expect(s.phase).toBe('run');
    t = run(s, t, 0.1);
    expect(s.phase).toBe('run');
    expect(onThrow(s, cfg, t, throwAt(t - 220), 'right')).toBe(true);
    expect(s.flightFoul).toBe(false);
    expect(s.phase).toBe('flight');
  });
  it('fouls once the grace has passed without a throw', () => {
    const { s, now } = started();
    let t = now;
    let guard = 0;
    while (s.crossT === 0 && guard++ < 4000) t = run(s, t, 0.01);
    run(s, t, cfg.crossGraceS + 0.1);
    expect(s.phase).toBe('flight');
    expect(s.dropped).toBe(true);
  });
  it('standing still never fouls, and shows the hint after the idle timeout', () => {
    const { s, now } = started();
    run(s, now, 5, 0, 0);
    expect(s.idleHint).toBe(false);
    run(s, now + 5000, 4, 0, 0);
    expect(s.idleHint).toBe(true);
    expect(s.phase).toBe('run');
    expect(s.position).toBe(0);
  });
});

describe('attempts and scoring', () => {
  function play(s: GameState, now: number, outcomes: ('foul' | 'throw')[]): number {
    let t = now;
    for (const o of outcomes) {
      // ready -> start
      onArmRaised(s, cfg, t, 'right', false, 'closed', 'right');
      expect(s.phase).toBe('run');
      if (o === 'throw') {
        t = run(s, t, 1.8);
        onThrow(s, cfg, t, throwAt(t), 'right');
      } else {
        t = run(s, t, 0.1);
        s.position = cfg.runwayLength - 0.1;
        s.speed = 8;
        t = run(s, t, 0.2);
      }
      t = run(s, t, 12);
    }
    return t;
  }

  it('plays three attempts, takes the best, and finishes once', () => {
    const s = createGame(attemptsFor(cfg, false));
    play(s, 1000, ['throw', 'foul', 'throw']);
    expect(s.phase).toBe('done');
    expect(s.records).toHaveLength(3);
    expect(s.doneSeq).toBe(1);
    expect(s.nextSeq).toBe(2);
    const valid = s.records.filter((r) => !r.foul).map((r) => r.distance);
    expect(s.best).toBe(Math.max(...valid));
    expect(s.records[1]!.foul).toBe(true);
    expect(attemptLine(1, s.records[1]!)).toBe('2: Foul');
    expect(attemptLine(0, s.records[0]!)).toMatch(/^1: \d+\.\d\d m$/);
    run(s, 0, 20);
    expect(s.doneSeq).toBe(1);
  });
  it('a short round has one attempt', () => {
    const s = createGame(attemptsFor(cfg, true));
    play(s, 1000, ['throw']);
    expect(s.phase).toBe('done');
    expect(s.records).toHaveLength(1);
  });
  it('all fouls score zero', () => {
    const s = createGame(3);
    play(s, 1000, ['foul', 'foul', 'foul']);
    expect(s.phase).toBe('done');
    expect(s.best).toBe(0);
    expect(s.bestIndex).toBe(-1);
    expect(s.records.every((r) => r.foul)).toBe(true);
  });
  it('resets the athlete between attempts', () => {
    const s = createGame(3);
    let t = 1000;
    onArmRaised(s, cfg, t, 'right', false, 'closed', 'right');
    t = run(s, t, 1.8);
    onThrow(s, cfg, t, throwAt(t), 'right');
    run(s, t, 8);
    expect(s.phase).toBe('ready');
    expect(s.position).toBe(0);
    expect(s.speed).toBe(0);
    expect(s.attempt).toBe(1);
  });
});
