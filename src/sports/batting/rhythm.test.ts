import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { battingConfig } from './config';
import { BattingRound } from './round';

const cfg = { ...battingConfig };

interface Marks {
  reset: number[];
  set: number[];
  windup: number[];
  release: number[];
  resolved: number[];
}

/** Run a no-swing round and record the time of each cycle event. */
function cycle(short: boolean, seed = 7): Marks {
  const marks: Marks = { reset: [], set: [], windup: [], release: [], resolved: [] };
  const clockRef = { t: 0 };
  const round = new BattingRound({
    cfg: { ...cfg },
    short,
    startMs: 0,
    random: mulberry32(seed),
    handedness: () => 'right',
    hooks: {
      reset: () => marks.reset.push(clockRef.t),
      set: (p) => marks.set.push(p.setStartMs),
      windup: (p) => marks.windup.push(p.windupStartMs),
      release: (p) => marks.release.push(p.releaseMs),
      resolved: () => marks.resolved.push(clockRef.t),
    },
  });
  for (let t = 0; t < 120000 && round.phase !== 'done'; t += 4) {
    clockRef.t = t;
    round.update(t);
  }
  return marks;
}

describe('pitch rhythm', () => {
  it('shows a get-ready reset, then the pitcher comes set, winds up and releases, in order', () => {
    const m = cycle(false);
    expect(m.reset).toHaveLength(10);
    expect(m.set).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(m.reset[i]!).toBeLessThan(m.set[i]!);
      expect(m.set[i]!).toBeLessThan(m.windup[i]!);
      expect(m.windup[i]!).toBeLessThan(m.release[i]!);
      expect(m.release[i]! - m.windup[i]!).toBe(cfg.windupMs);
    }
  });

  it('the first pitch has a longer lead-in than the later ones', () => {
    const m = cycle(false);
    expect(m.reset[0]).toBeLessThanOrEqual(4);
    expect(m.set[0]).toBe(cfg.firstPitchDelayMs);
    const first = m.release[0]!;
    const later = m.release[1]! - m.resolved[0]!;
    expect(first).toBeGreaterThan(later);
  });

  it('is about 3 to 4.6 seconds from a result to the next release', () => {
    const m = cycle(false);
    for (let i = 1; i < m.release.length; i++) {
      const gap = m.release[i]! - m.resolved[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(3000);
      expect(gap).toBeLessThanOrEqual(4600);
    }
  });

  it('the set is not metronomic but is deterministic for a seed', () => {
    const a = cycle(false, 11);
    const b = cycle(false, 11);
    const c = cycle(false, 12);
    expect(a.windup).toEqual(b.windup);
    const holds = a.windup.map((w, i) => w - a.set[i]!);
    expect(new Set(holds).size).toBeGreaterThan(3);
    for (const h of holds) {
      expect(h).toBeGreaterThanOrEqual(cfg.setMs - cfg.setJitterMs);
      expect(h).toBeLessThanOrEqual(cfg.setMs + cfg.setJitterMs);
    }
    expect(c.windup).not.toEqual(a.windup);
  });

  it('a short round shortens the gaps but not the wind-up', () => {
    const m = cycle(true);
    expect(m.set[0]).toBeCloseTo(cfg.firstPitchDelayMs * cfg.shortGapScale, 5);
    for (let i = 0; i < m.set.length; i++) expect(m.release[i]! - m.windup[i]!).toBe(cfg.windupMs);
    expect(m.release[1]! - m.resolved[0]!).toBeLessThan(2500);
  });

  it('reports the stage of the cycle', () => {
    const round = new BattingRound({
      cfg: { ...cfg },
      short: false,
      startMs: 0,
      random: mulberry32(3),
      handedness: () => 'right',
    });
    expect(round.stage(0)).toBe('reset');

    round.update(cfg.firstPitchDelayMs + 8);
    expect(round.stage(cfg.firstPitchDelayMs + 8)).toBe('set');
    const p = round.pitch!;
    round.update(p.windupStartMs + 8);
    expect(round.stage(p.windupStartMs + 8)).toBe('windup');
    round.update(p.releaseMs + 8);
    expect(round.stage(p.releaseMs + 8)).toBe('flight');
  });
});
