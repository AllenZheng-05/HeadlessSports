import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { javelinConfig } from './config';
import {
  attemptLine,
  attemptsFor,
  createGame,
  createMouseRun,
  distanceToLine,
  onStep,
  onThrow,
  requiredThrowSpeed,
  stepGame,
  stepMouseRun,
} from './game';
import type { GameState, MouseRun, ThrowInput } from './game';
import { flightRange } from './distance';

const cfg = { ...javelinConfig };
const DT = 1 / 120;

/**
 * Run the rules for `seconds` of game time with a step every 1/sps s (none when sps is 0),
 * returning the new clock.
 */
function run(s: GameState, now: number, seconds: number, sps = 4, amp = 0.45): number {
  const n = Math.round(seconds * 120);
  let t = now;
  // Steps fall on a fixed grid of the clock, so many short calls step like one long one.
  let nextStep = sps > 0 ? (Math.floor(t / (1000 / sps)) + 1) * (1000 / sps) : Infinity;
  for (let i = 0; i < n; i++) {
    t += DT * 1000;
    while (t >= nextStep) {
      onStep(s, cfg, nextStep);
      nextStep += 1000 / sps;
    }
    stepGame(s, cfg, DT, t, amp);
  }
  return t;
}

/** Step the rules until the phase is `phase` (or `max` seconds pass). */
function until(s: GameState, now: number, phase: GameState['phase'], max = 30): number {
  let t = now;
  for (let i = 0; i < max * 20 && s.phase !== phase; i++) t = run(s, t, 0.05, 0);
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

/** A round whose run has just started (the get-ready beat is over). */
function started(): { s: GameState; now: number } {
  const s = createGame(3);
  const now = run(s, 0, cfg.readyMs / 1000 + 0.05, 0);
  return { s, now };
}

describe('start', () => {
  it('begins by itself after the get-ready beat, with no gesture', () => {
    const s = createGame(3);
    run(s, 0, cfg.readyMs / 1000 - 0.2, 0);
    expect(s.phase).toBe('ready');
    run(s, 0, cfg.readyMs / 1000 + 0.05, 0);
    expect(s.phase).toBe('run');
    expect(s.startSeq).toBe(1);
  });
  it('no javelin code reads fist or hand state', () => {
    for (const f of ['game', 'index', 'bot', 'runSpeed', 'distance']) {
      const text = readFileSync(`src/sports/javelin/${f}.ts`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/fist|\.hands|\.closed|ArmRaised|ArmLowered|handCrops: true/i);
    }
  });
});

describe('run speed follows the step rate', () => {
  function speedAfter(sps: number, seconds: number): number {
    const { s, now } = started();
    run(s, now, seconds, sps);
    return s.speed;
  }
  it('a faster cadence gives a higher run speed, continuously', () => {
    let prev = -1;
    for (const sps of [1.5, 2, 2.5, 3, 3.5, 4]) {
      const v = speedAfter(sps, 3);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(speedAfter(4, 3)).toBeGreaterThan(speedAfter(2, 3) * 1.6);
  });
  it('speeds up within a step or two', () => {
    const { s, now } = started();
    run(s, now, 0.9, 4);
    expect(s.speed).toBeGreaterThan(3);
  });
  it('slows down smoothly when the player slows, and stops when they stop', () => {
    const { s, now } = started();
    let t = run(s, now, 3, 4);
    const fast = s.speed;
    t = run(s, t, 1.5, 2.2);
    const mid = s.speed;
    expect(mid).toBeLessThan(fast);
    expect(mid).toBeGreaterThan(0.2 * fast);
    run(s, t, 4, 0);
    expect(s.speed).toBe(0);
  });
});

describe('throw guard', () => {
  it('arm pumping while running does not throw, a big motion does', () => {
    const { s, now } = started();
    const t = run(s, now, 2.5, 4);
    const need = requiredThrowSpeed(s, cfg);
    expect(need).toBeGreaterThan(cfg.minThrowSpeed + 0.5 * cfg.pumpMargin);
    // Arm swing at running pace: well under the guard.
    expect(onThrow(s, cfg, t, throwAt(t, { speed: 2.8 }), 'right')).toBe(false);
    expect(onThrow(s, cfg, t, throwAt(t, { speed: need - 0.1 }), 'right')).toBe(false);
    expect(s.phase).toBe('run');
    expect(onThrow(s, cfg, t, throwAt(t, { speed: need + 0.1 }), 'right')).toBe(true);
    expect(s.phase).toBe('flight');
  });
  it('a hand below the shoulder at the peak is not a throw', () => {
    const { s, now } = started();
    const t = run(s, now, 1, 4);
    expect(onThrow(s, cfg, t, throwAt(t, { style: 'underarm' }), 'right')).toBe(false);
  });
  it('needs no pose first: a throw is accepted whenever the run is on', () => {
    const { s, now } = started();
    const t = run(s, now, 0.6, 0);
    expect(onThrow(s, cfg, t, throwAt(t), 'right')).toBe(true);
  });
});

/** Drive the mouse flow like the sport does: one fixed step at a time. */
function mouseSim(s: GameState, m: MouseRun, t0: number) {
  let t = t0;
  let releases = m.seenReleases;
  return {
    get t() {
      return t;
    },
    release: () => {
      releases++;
    },
    step(seconds: number, down: boolean): void {
      const n = Math.round(seconds * 120);
      for (let i = 0; i < n; i++) {
        t += DT * 1000;
        const target = stepMouseRun(m, s, cfg, t, DT, down, releases, false, 'right');
        stepGame(s, cfg, DT, t, 0, target);
      }
    },
  };
}

describe('mouse play', () => {
  it('holding runs at the set speed, with no tap rate or other input', () => {
    const s = createGame(1);
    const m = createMouseRun(0);
    const sim = mouseSim(s, m, 0);
    sim.step(cfg.readyMs / 1000 + 0.05, true);
    expect(s.phase).toBe('run');
    sim.step(1.5, true);
    expect(s.speed).toBeCloseTo(cfg.mouseRunSpeed, 6);
    expect(s.position).toBeGreaterThan(5);
  });
  it('does not run without the button, and stops when it is let go before the run', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, false);
    sim.step(2, false);
    expect(s.phase).toBe('run');
    expect(s.speed).toBe(0);
    expect(s.position).toBe(0);
  });
  it('a press during the get-ready beat starts the run when it ends, if still held', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 - 0.3, true);
    expect(s.phase).toBe('ready');
    expect(s.speed).toBe(0);
    sim.step(0.4, true);
    expect(s.phase).toBe('run');
    sim.step(0.5, true);
    expect(s.speed).toBeGreaterThan(3);
  });
  it('a release during the ready beat does nothing', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(0.5, true);
    sim.release();
    sim.step(cfg.readyMs / 1000, false);
    expect(s.phase).toBe('run');
    expect(s.records).toHaveLength(0);
    sim.step(0.5, false);
    expect(s.phase).toBe('run');
  });
  it('letting go throws once with the fixed power and loft', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, true);
    sim.step(1.5, true);
    sim.release();
    sim.step(DT * 2, false);
    expect(s.phase).toBe('flight');
    expect(s.releaseSeq).toBe(1);
    expect(s.release.throwSpeed).toBe(cfg.mouseThrowSpeed);
    expect(s.release.angleDeg).toBeCloseTo(cfg.mouseLoftDeg, 6);
    expect(s.release.runSpeed).toBeCloseTo(cfg.mouseRunSpeed, 6);
    sim.step(8, false);
    expect(s.releaseSeq).toBe(1);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]!.foul).toBe(false);
  });
  it('a very short tap runs briefly, then throws', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, false);
    sim.step(0.05, true);
    sim.release();
    sim.step(0.05, false);
    expect(s.phase).toBe('run');
    sim.step(0.3, false);
    expect(s.phase).toBe('flight');
    expect(s.release.runSpeed).toBeGreaterThan(0);
    expect(s.position).toBeGreaterThan(0.3);
    sim.step(8, false);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]!.foul).toBe(false);
  });
  it('a release just before the line is a strong throw', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, true);
    while (distanceToLine(s, cfg) > 1) sim.step(0.01, true);
    sim.release();
    sim.step(DT * 2, false);
    expect(s.flightFoul).toBe(false);
    sim.step(8, false);
    expect(s.records[0]!.distance).toBeGreaterThan(60);
  });
  it('a release after the line is a foul', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, true);
    while (distanceToLine(s, cfg) > -0.1) sim.step(0.01, true);
    expect(s.phase).toBe('run');
    sim.release();
    sim.step(DT * 2, false);
    expect(s.flightFoul).toBe(true);
    sim.step(8, false);
    expect(s.records[0]).toMatchObject({ foul: true, distance: 0 });
  });
  it('holding across the line is a foul and the javelin drops', () => {
    const s = createGame(1);
    const sim = mouseSim(s, createMouseRun(0), 0);
    sim.step(cfg.readyMs / 1000 + 0.05, true);
    sim.step(10, true);
    expect(s.dropped).toBe(true);
    sim.step(5, true);
    expect(s.records[0]).toMatchObject({ foul: true, distance: 0, why: 'crossed' });
  });
  it('the fixed loft is close to the best angle for the fixed power', () => {
    const v = cfg.baseSpeed + cfg.runGain * (cfg.mouseRunSpeed / cfg.maxRunSpeed) + cfg.throwGain;
    let bestAngle = 0;
    let best = 0;
    for (let a = 10; a <= 52; a++) {
      const r = flightRange(cfg, v, a);
      if (r > best) {
        best = r;
        bestAngle = a;
      }
    }
    expect(Math.abs(cfg.mouseLoftDeg - bestAngle)).toBeLessThanOrEqual(3);
  });
});

describe('distance rewards the approach', () => {
  function throwDistance(sps: number, arm: number): number {
    const { s, now } = started();
    const t = run(s, now, 3, sps);
    expect(s.position).toBeLessThan(cfg.runwayLength - 2);
    expect(onThrow(s, cfg, t, throwAt(t, { speed: arm }), 'right')).toBe(true);
    run(s, t, 8, 0);
    expect(s.records[0]!.foul).toBe(false);
    return s.records[0]!.distance;
  }
  it('faster cadence, same arm: longer throw, by a substantial amount', () => {
    const slow = throwDistance(2, 8);
    const mid = throwDistance(3, 8);
    const fast = throwDistance(4, 8);
    expect(mid).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(mid);
    expect(fast / slow).toBeGreaterThan(1.15);
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
  it('need the throwing hand, the speed floor and (optionally) an overarm style', () => {
    const { s, now } = started();
    const t = run(s, now, 1);
    expect(onThrow(s, cfg, t, throwAt(t, { hand: 'left' }), 'right')).toBe(false);
    expect(onThrow(s, cfg, t, throwAt(t, { speed: 1 }), 'right')).toBe(false);
    expect(onThrow(s, cfg, t, throwAt(t, { style: 'underarm' }), 'right')).toBe(false);
    cfg.acceptAnyStyle = true;
    expect(onThrow(s, cfg, t, throwAt(t, { style: 'underarm' }), 'right')).toBe(true);
    cfg.acceptAnyStyle = false;
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
      // ready -> start by itself
      t = run(s, t, cfg.readyMs / 1000 + 0.05, 0);
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
      t = until(s, t, s.attempt + 1 >= s.total ? 'done' : 'ready');
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
    let t = run(s, 1000, cfg.readyMs / 1000 + 0.05, 0);
    t = run(s, t, 1.8);
    onThrow(s, cfg, t, throwAt(t), 'right');
    until(s, t, 'ready');
    expect(s.phase).toBe('ready');
    expect(s.position).toBe(0);
    expect(s.speed).toBe(0);
    expect(s.attempt).toBe(1);
  });
});
