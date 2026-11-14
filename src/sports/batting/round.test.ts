import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { battingConfig } from './config';
import { hitWorldPosition, trajectoryAt } from './flight';
import { noSwingResolveMs } from './judge';
import { BattingRound } from './round';
import type { PitchResult, RoundSummary } from './round';

const cfg = { ...battingConfig };

interface Rig {
  round: BattingRound;
  results: PitchResult[];
  finished: RoundSummary[];
  log: string[];
}

function makeRound(short = false, over: Partial<typeof cfg> = {}, realtime = false): Rig {
  const results: PitchResult[] = [];
  const finished: RoundSummary[] = [];
  const log: string[] = [];
  const c = { ...cfg, ...over };
  const round = new BattingRound({
    cfg: c,
    short,
    startMs: 0,
    random: mulberry32(7),
    handedness: () => 'right',
    realtime,
    hooks: {
      windup: (p) => log.push(`windup ${p.index}`),
      release: (p) => log.push(`release ${p.index}`),
      swing: () => log.push('swing'),
      resolved: (r) => {
        results.push(r);
        log.push(`resolved ${r.kind}`);
      },
      ending: () => log.push('ending'),
      finish: (s) => finished.push(s),
    },
  });
  return { round, results, finished, log };
}

/** Height (sw) that puts the bat level with the ball for the current pitch. */
function levelHeight(ty: number, drop = 0): number {
  return (ty - cfg.shoulderHeightM + cfg.batDrop + drop) / cfg.swToMetres;
}

/** Step the round in 8 ms frames up to `to`, optionally calling `each` each frame. */
function runTo(rig: Rig, from: number, to: number, each?: (t: number) => void): number {
  let t = from;
  while (t < to) {
    t += 8;
    each?.(t);
    rig.round.update(t);
  }
  return t;
}

/** Play the whole round, swinging with `error` ms of timing error at every pitch. */
function playAll(rig: Rig, error: number | null, peak = 9, eventDelay = 100): void {
  let t = 0;
  let swungFor = 0;
  let pendingPeak = -1;
  for (let guard = 0; guard < 200000 && rig.round.phase !== 'done'; guard++) {
    t += 8;
    const r = rig.round;
    const p = r.pitch;
    if (error !== null && p !== null && r.phase === 'pitch' && swungFor !== p.index) {
      const swingT = p.arrivalMs + error - cfg.batTravelMs;
      // The event is delivered `eventDelay` ms after it happened.
      if (t >= swingT + eventDelay) {
        swungFor = p.index;
        r.onSwingStarted({ t: swingT, speed: 6, height: levelHeight(p.ty, -0.1) }, t);
        pendingPeak = t + 40;
      }
    }
    if (pendingPeak > 0 && t >= pendingPeak) {
      r.onSwingPeak({ speed: peak }, t);
      pendingPeak = -1;
    }
    r.update(t);
  }
}

describe('round structure', () => {
  it('plays 10 pitches in a full round and 3 in a short one', () => {
    const full = makeRound(false);
    playAll(full, null);
    expect(full.results).toHaveLength(10);
    expect(full.finished).toHaveLength(1);
    expect(full.finished[0]!.pitches).toBe(10);
    const short = makeRound(true);
    playAll(short, null);
    expect(short.results).toHaveLength(3);
    expect(short.finished[0]!.pitches).toBe(3);
  });

  it('calls finish exactly once, after the ending hook', () => {
    const rig = makeRound(true);
    playAll(rig, 0);
    runTo(rig, 100000, 120000);
    expect(rig.finished).toHaveLength(1);
    const i = rig.log.indexOf('ending');
    expect(i).toBeGreaterThan(0);
    expect(rig.log.filter((x) => x === 'ending')).toHaveLength(1);
  });

  it('a round with no swings scores 0 and every pitch is a strike', () => {
    const rig = makeRound(true);
    playAll(rig, null);
    expect(rig.results.every((r) => r.kind === 'strike' && r.label === 'Strike')).toBe(true);
    expect(rig.finished[0]!.score).toBe(0);
    expect(rig.finished[0]!.misses).toBe(3);
  });

  it('score is the sum of rounded hit distances plus the home-run bonus', () => {
    const rig = makeRound(false);
    playAll(rig, 0);
    const s = rig.finished[0]!;
    let sum = 0;
    let homers = 0;
    for (const r of rig.results) {
      if (r.kind === 'hit') {
        sum += r.distance;
        if (r.homer) {
          homers++;
          sum += cfg.homerBonus;
        }
      }
    }
    expect(homers).toBeGreaterThan(0);
    expect(s.homers).toBe(homers);
    expect(s.score).toBe(sum);
    expect(s.hits).toBe(10);
    expect(s.best).toBe(Math.max(...rig.results.map((r) => r.distance)));
    expect(s.totalTimingErrorMs).toBe(0);
  });

  it('waits longer after a long fly, capped', () => {
    const rig = makeRound(false);
    playAll(rig, 0);
    for (let i = 1; i < rig.results.length; i++) {
      const gap = rig.results[i]!.pitch.windupStartMs - rig.results[i - 1]!.contactMs;
      expect(gap).toBeLessThanOrEqual(cfg.maxBetweenPitchesMs + 400);
    }
  });
});

describe('swing handling', () => {
  it('resolves a pitch with no swing only after the window and the event-delay allowance', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    expect(p.index).toBe(1);
    const at = noSwingResolveMs(p, cfg);
    t = runTo(rig, t, at - 20);
    expect(rig.results).toHaveLength(0);
    runTo(rig, t, at + 20);
    expect(rig.results).toHaveLength(1);
    expect(rig.results[0]!.kind).toBe('strike');
  });

  it('only the first swing counts for a pitch', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    t = runTo(rig, t, p.releaseMs + 50);
    const first = { t: p.arrivalMs - cfg.batTravelMs + 30, speed: 6, height: levelHeight(p.ty) };
    rig.round.onSwingStarted(first, t);
    rig.round.onSwingStarted({ ...first, t: first.t - 80 }, t); // earlier and better: ignored
    expect(rig.log.filter((x) => x === 'swing')).toHaveLength(1);
    rig.round.onSwingPeak({ speed: 8 }, t + 20);
    runTo(rig, t, p.arrivalMs + 300);
    expect(rig.results).toHaveLength(1);
    expect(rig.results[0]!.judgement!.timingError).toBe(30);
  });

  it('ignores swings outside any pitch window', () => {
    const rig = makeRound();
    // Before the first wind-up begins.
    rig.round.onSwingStarted({ t: 100, speed: 6, height: 0 }, 110);
    expect(rig.log).toEqual([]);
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    // Started before this pitch's wind-up.
    rig.round.onSwingStarted({ t: p.windupStartMs - 200, speed: 6, height: 0 }, t);
    // Started after the late window.
    rig.round.onSwingStarted({ t: p.arrivalMs + cfg.lateWindowMs + 50, speed: 6, height: 0 }, t);
    expect(rig.log.filter((x) => x === 'swing')).toHaveLength(0);
    t = runTo(rig, t, noSwingResolveMs(p, cfg) + 20);
    expect(rig.results[0]!.kind).toBe('strike');
    // And between pitches.
    rig.round.onSwingStarted({ t, speed: 6, height: 0 }, t);
    expect(rig.log.filter((x) => x === 'swing')).toHaveLength(0);
  });

  it('a swing after the wind-up began but before the release is a too-early whiff', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    rig.round.onSwingStarted({ t: p.windupStartMs + 300, speed: 6, height: levelHeight(p.ty) }, t);
    rig.round.onSwingPeak({ speed: 8 }, t + 30);
    t = runTo(rig, t, p.arrivalMs + 100);
    expect(rig.results).toHaveLength(1);
    expect(rig.results[0]!.label).toBe('Too early');
    expect(rig.results[0]!.kind).toBe('miss');
    // The player cannot be credited later: no second swing counts for this pitch.
    rig.round.onSwingStarted({ t: p.arrivalMs - 130, speed: 6, height: levelHeight(p.ty) }, t);
    expect(rig.log.filter((x) => x === 'swing')).toHaveLength(1);
  });

  it('power comes from SwingPeak when it arrives in time, else from the start speed', () => {
    const run = (peak: number | null): number => {
      const rig = makeRound();
      let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
      const p = rig.round.pitch!;
      t = runTo(rig, t, p.releaseMs + 100);
      const sw = { t: p.arrivalMs - cfg.batTravelMs, speed: 5, height: levelHeight(p.ty, 0.1) };
      rig.round.onSwingStarted(sw, t);
      if (peak !== null) rig.round.onSwingPeak({ speed: peak }, t + 40);
      runTo(rig, t, p.arrivalMs + 500);
      return rig.results[0]!.judgement!.power;
    };
    expect(run(9)).toBe(1);
    expect(run(4)).toBeCloseTo(1 / 6, 9);
    expect(run(null)).toBeCloseTo((5 * 1.5 - 3) / 6, 9); // no peak: start speed times the gain
  });

  it('a peak that arrives after peakWaitMs is ignored', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    t = runTo(rig, t, p.releaseMs + 100);
    rig.round.onSwingStarted(
      { t: p.arrivalMs - cfg.batTravelMs, speed: 5, height: levelHeight(p.ty, 0.1) },
      t,
    );
    runTo(rig, t, t + cfg.peakWaitMs + 50);
    rig.round.onSwingPeak({ speed: 9 }, t + cfg.peakWaitMs + 60);
    runTo(rig, t + cfg.peakWaitMs + 50, p.arrivalMs + 500);
    expect(rig.results[0]!.judgement!.power).toBeCloseTo((5 * 1.5 - 3) / 6, 9);
  });
});

describe('latency compensation', () => {
  it('a hit resolved late is judged by its timestamp, not its arrival', () => {
    const delays = [0, 60, 150, 220];
    const errors = delays.map((d) => {
      const rig = makeRound();
      let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
      const p = rig.round.pitch!;
      const swingT = p.arrivalMs - cfg.batTravelMs + 20; // contact 20 ms late
      t = runTo(rig, t, swingT + d);
      rig.round.onSwingStarted({ t: swingT, speed: 6, height: levelHeight(p.ty, 0.1) }, t);
      rig.round.onSwingPeak({ speed: 9 }, t + 8);
      runTo(rig, t, p.arrivalMs + 1000);
      expect(rig.results[0]!.kind).toBe('hit');
      return rig.results[0]!.judgement!.timingError;
    });
    expect(errors).toEqual([20, 20, 20, 20]);
  });

  it('a hit resolved 150 ms after contact is placed 150 ms into its flight', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    const swingT = p.arrivalMs - cfg.batTravelMs; // perfect: contact at arrival
    const resolveAt = p.arrivalMs + 150;
    t = runTo(rig, t, resolveAt - 30);
    expect(rig.results).toHaveLength(0);
    rig.round.onSwingStarted({ t: swingT, speed: 6, height: levelHeight(p.ty, 0.1) }, t);
    rig.round.onSwingPeak({ speed: 9 }, t + 8);
    t = runTo(rig, t, resolveAt + 20);
    const r = rig.results[0]!;
    expect(r.kind).toBe('hit');
    expect(r.contactMs).toBe(p.arrivalMs);
    const out = { x: 0, y: 0, z: 0 };
    const late = t - r.contactMs;
    expect(late).toBeGreaterThan(130);
    hitWorldPosition(r.trajectory!, r.headingDeg, cfg.plateZ, late, out);
    // Not at the plate: it has travelled for `late` ms already.
    const probe = { d: 0, y: 0 };
    trajectoryAt(r.trajectory!, late / 1000, probe);
    expect(probe.d).toBeGreaterThan(3);
    expect(out.z).toBeCloseTo(cfg.plateZ - probe.d * Math.cos((r.headingDeg * Math.PI) / 180), 6);
    // And exactly where an on-time resolution would have put it at the same clock time.
    const onTime = { x: 0, y: 0, z: 0 };
    hitWorldPosition(r.trajectory!, r.headingDeg, cfg.plateZ, t - p.arrivalMs, onTime);
    expect(out).toEqual(onTime);
  });

  it('a swing reported before contact waits for contact to resolve', () => {
    const rig = makeRound();
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    t = runTo(rig, t, p.releaseMs + 100);
    rig.round.onSwingStarted(
      { t, speed: 6, height: levelHeight(p.ty, 0.1) }, // debug input: reported on time
      t,
    );
    rig.round.onSwingPeak({ speed: 9 }, t + 8);
    t = runTo(rig, t, t + 40);
    expect(rig.results).toHaveLength(0);
    runTo(rig, t, p.arrivalMs + 400);
    expect(rig.results).toHaveLength(1);
  });
});

describe('pauses', () => {
  it('a real-time gap longer than pauseGapMs shifts the whole timeline', () => {
    const rig = makeRound(false, {}, true);
    let t = runTo(rig, 0, cfg.firstPitchDelayMs + 10);
    const p = rig.round.pitch!;
    const arrival = p.arrivalMs;
    t = runTo(rig, t, p.releaseMs + 100);
    rig.round.update(t + 3000); // the camera paused for 3 s
    expect(rig.round.pitch!.arrivalMs).toBeCloseTo(arrival + 3000 - 0, -1);
    expect(rig.results).toHaveLength(0);
  });
});
