import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { TrackedInput } from '../../input/TrackedInput';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { createBattingBot } from './bot';
import { battingConfig, DISTANCE_SCALE, HOMER_FEET } from './config';
import type { BattingConfig } from './config';
import { simulateHit } from './flight';
import { BattingRound } from './round';
import type { PitchResult } from './round';
import { metresToFeet } from './units';

const S = DISTANCE_SCALE;
const R = Math.sqrt(S);
const cfg = { ...battingConfig };

/** The original 246 ft model: the same config with every distance-scaled number put back. */
const oldCfg: BattingConfig = {
  ...battingConfig,
  minExit: battingConfig.minExit / R,
  maxExit: battingConfig.maxExit / R,
  drag: battingConfig.drag * S,
  rollTau: battingConfig.rollTau / R,
  fenceDistance: 75,
  heightScale: 1,
  homerRollMax: 6,
  homerBonus: 66,
  cameraFollowFrom: 30,
  cameraFollowFull: 40,
  airBeatScale: 1,
};

describe('350 ft home run distance', () => {
  it('the fence is 350 ft', () => {
    expect(HOMER_FEET).toBe(350);
    expect(metresToFeet(cfg.fenceDistance)).toBe(350);
    expect(S).toBeCloseTo(1.4224, 4);
    expect(oldCfg.minExit).toBeCloseTo(18, 9);
    expect(oldCfg.maxExit).toBeCloseTo(46, 9);
    expect(metresToFeet(oldCfg.fenceDistance)).toBe(246);
  });

  // Recorded from the 246 ft model before the change: [exit m/s, launch deg, total m, homer].
  const recorded: [number, number, number, boolean][] = [
    [18, 10, 16.845, false],
    [30, 28, 69.911, false],
    [36, 20, 78.407, false],
    [36, 28, 89.588, true],
    [41, 10, 61.531, false],
    [41, 20, 91.116, true],
    [46, 28, 124.557, true],
    [46, 40, 134.93, true],
    [46, -8, 38.384, false],
    [25, 2, 20.861, false],
  ];
  it('the old model is still reachable and matches the recorded distances', () => {
    for (const [v, a, total, homer] of recorded) {
      const t = simulateHit(v, a, oldCfg);
      expect(t.total).toBeCloseTo(total, 2);
      expect(t.homer).toBe(homer);
    }
  });

  it('every contact goes the distance scale further and the home-run set is unchanged', () => {
    let homers = 0;
    let worst = 0;
    for (let v = 18; v <= 46; v += 1) {
      for (let a = -12; a <= 55; a += 1) {
        const before = simulateHit(v, a, oldCfg);
        const after = simulateHit(v * R, a, cfg);
        expect(after.homer).toBe(before.homer);
        if (before.homer) homers++;
        // Skip balls that land within 0.5% of the wall: whether they are blocked is a knife edge.
        if (Math.abs(before.carry / 75 - 1) < 0.005) continue;
        worst = Math.max(worst, Math.abs(after.total / before.total / S - 1));
      }
    }
    expect(homers).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.01);
  });

  it('the exit speed that just reaches the fence scales with the model', () => {
    for (const a of [20, 28, 40]) {
      const reach = (c: BattingConfig): number => {
        let lo = 5;
        let hi = 120;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (simulateHit(mid, a, c).homer) hi = mid;
          else lo = mid;
        }
        return hi;
      };
      const vNew = reach(cfg);
      expect(vNew / reach(oldCfg)).toBeCloseTo(R, 2);
      expect(simulateHit(vNew * 0.95, a, cfg).homer).toBe(false);
      expect(simulateHit(vNew * 1.05, a, cfg).homer).toBe(true);
    }
  });

  it('a ball landing at 349 ft is not a home run, one over the 350 ft wall is', () => {
    // Exit speed for a 30 degree hit that would land a given distance away with no wall in the way.
    const open = { ...cfg, fenceDistance: 1e6 };
    const landing = (feet: number): number => {
      let lo = 10;
      let hi = 80;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (simulateHit(mid, 30, open).carry / 0.3048 < feet) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    const short = simulateHit(landing(349), 30, cfg);
    expect(metresToFeet(short.carry)).toBe(349);
    expect(short.homer).toBe(false);
    // A ball that would land just past the line is still under the 1.2 m top of the wall as it
    // crosses: it hits the wall and is scored at the fence, 350 ft, with no home run.
    const wall = simulateHit(landing(351), 30, cfg);
    expect(wall.homer).toBe(false);
    expect(metresToFeet(wall.total)).toBe(350);
    // Clearing the top of the wall takes about 8 ft more (5.4 ft at the old 246 ft fence).
    const over = simulateHit(landing(360), 30, cfg);
    expect(over.homer).toBe(true);
    expect(over.carry).toBeGreaterThan(350 * 0.3048);
    expect(metresToFeet(over.carry)).toBeLessThanOrEqual(362);
    // Home runs are reported at 350 ft or more.
    expect(metresToFeet(over.total)).toBeGreaterThanOrEqual(350);
  });
});

/** A full bot round with the given model. */
function playRound(c: BattingConfig, seed: number): PitchResult[] {
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  const results: PitchResult[] = [];
  let clock = 0;
  const round = new BattingRound({
    cfg: c,
    short: false,
    startMs: 0,
    random: mulberry32(seed),
    handedness: () => 'right',
    hooks: { resolved: (r) => results.push(r) },
  });
  input.on('SwingStarted', (e) => round.onSwingStarted(e, clock));
  input.on('SwingPeak', (e) => round.onSwingPeak(e, clock));
  const bot = createBattingBot({
    cfg: c,
    random: mulberry32(seed + 1000),
    view: {
      pitch: () =>
        round.phase === 'pitch' && !round.resolved && round.swingT < 0 ? round.pitch : null,
      over: () => round.phase === 'ending' || round.phase === 'done',
      frameT: () => input.state.t,
    },
  });
  source.setDirector((_q, rel) => bot.next((steps) => source.queue?.enqueue(steps), rel));
  void input.start({ pose: true, handCrops: false, fullFrameHands: false });
  for (let i = 0; i < 60 * 200 && round.phase !== 'done'; i++) {
    clock = (i * 1000) / 60;
    input.update(clock);
    round.update(clock);
  }
  input.stop();
  return results;
}

describe('bot rounds are the same difficulty at 350 ft', () => {
  it('the same pitches give the same home runs and S times the distance', () => {
    // The result beat is pinned so both models share one pitch timeline.
    const pin = (c: BattingConfig): BattingConfig => ({ ...c, maxResultBeatMs: c.resultBeatMs });
    let homersOld = 0;
    let homersNew = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const before = playRound(pin(oldCfg), seed);
      const after = playRound(pin(cfg), seed);
      expect(after).toHaveLength(before.length);
      before.forEach((b, i) => {
        const a = after[i]!;
        expect(a.kind).toBe(b.kind);
        expect(a.homer).toBe(b.homer);
        if (b.kind === 'hit' && b.distance > 60) expect(a.distance / b.distance).toBeCloseTo(S, 1);
        if (b.homer) homersOld++;
        if (a.homer) homersNew++;
      });
    }
    expect(homersNew).toBe(homersOld);
    expect(homersOld).toBeGreaterThan(40);
  });
});
