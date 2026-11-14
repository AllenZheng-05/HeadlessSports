import { describe, expect, it } from 'vitest';
import { pitchingConfig as cfg } from './config';
import { BALK_SCORE, scorePitch, summarize } from './scoring';
import type { PitchRecord } from './scoring';
import { cellCentre } from './zone';

const at = (cell: number): { x: number; y: number } => cellCentre(cfg, cell, { x: 0, y: 0 });
const score = (x: number, y: number, target: number, kind: 'fastball' | 'curve', kmh: number) =>
  scorePitch(cfg, x, y, target, kind, kmh);

describe('scorePitch tiers', () => {
  it('exact cell is 10 plus the speed bonus', () => {
    const p = at(4);
    const s = score(p.x, p.y, 4, 'fastball', cfg.minKmh);
    expect(s.tier).toBe('bullseye');
    expect(s.base).toBe(10);
    expect(s.points).toBe(10);
  });
  it('adjacent cells, diagonals included, are 5', () => {
    for (const c of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const p = at(c);
      expect(score(p.x, p.y, 4, 'fastball', 55).base).toBe(5);
    }
  });
  it('elsewhere in the zone is 3', () => {
    const p = at(8);
    const s = score(p.x, p.y, 0, 'fastball', 55);
    expect(s.tier).toBe('zone');
    expect(s.points).toBe(3);
  });
  it('a near miss is 1 and gets no speed bonus; wild is 0', () => {
    const near = score(0.25 + 0.1, cfg.zoneCentreY, 4, 'fastball', 95);
    expect(near.tier).toBe('near');
    expect(near.points).toBe(1);
    const wild = score(0.9, 2, 4, 'fastball', 95);
    expect(wild.tier).toBe('wild');
    expect(wild.points).toBe(0);
  });
});

describe('scorePitch bonuses', () => {
  it('speed bonus is linear from minKmh to the cap, and never above', () => {
    const p = at(4);
    expect(score(p.x, p.y, 4, 'fastball', cfg.minKmh).speedBonus).toBe(0);
    expect(score(p.x, p.y, 4, 'fastball', 75).speedBonus).toBe(2);
    expect(score(p.x, p.y, 4, 'fastball', cfg.scoredSpeedCapKmh).speedBonus).toBe(3);
    expect(score(p.x, p.y, 4, 'fastball', 200).speedBonus).toBe(3);
  });
  it('curve bonus only in the target cell; painted corner label on corners', () => {
    const c = at(0);
    const s = score(c.x, c.y, 0, 'curve', 55);
    expect(s.curveBonus).toBe(2);
    expect(s.label).toBe('Painted the corner');
    const m = at(4);
    const mid = score(m.x, m.y, 4, 'curve', 55);
    expect(mid.curveBonus).toBe(2);
    expect(mid.label).toBe('Bullseye');
    const adj = at(1);
    expect(score(adj.x, adj.y, 0, 'curve', 55).curveBonus).toBe(0);
    expect(score(c.x, c.y, 0, 'fastball', 55).curveBonus).toBe(0);
  });
  it('the best pitch is 15', () => {
    const c = at(2);
    expect(score(c.x, c.y, 2, 'curve', 95).points).toBe(15);
    expect(score(c.x, c.y, 2, 'fastball', 95).points).toBe(13);
  });
});

describe('summarize', () => {
  const rec = (
    i: number,
    p: ReturnType<typeof score>,
    kind: 'fastball' | 'curve',
    kmh: number,
    miss: number,
  ): PitchRecord => ({
    index: i,
    kind,
    target: 4,
    balk: false,
    x: 0,
    y: 0.8,
    kmh,
    score: p,
    missM: miss,
  });
  it('sums points and builds the detail', () => {
    const p = at(4);
    const a = score(p.x, p.y, 4, 'fastball', 95);
    const b = score(0.9, 2, 4, 'curve', 70);
    const bal: PitchRecord = { ...rec(2, BALK_SCORE, 'fastball', 0, 0), balk: true };
    const s = summarize([rec(0, a, 'fastball', 98.4, 0.1), rec(1, b, 'curve', 70, 0.3), bal]);
    expect(s).toEqual({
      score: a.points,
      pitches: 3,
      strikes: 1,
      bullseyes: 1,
      balks: 1,
      fastballs: 1,
      curves: 1,
      bestKmh: 98,
      meanMissCm: 20,
    });
  });
});
