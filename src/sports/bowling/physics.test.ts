import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { createRapierBowling } from './physics';
import type { RapierBowling } from './physics';

const DT = 1 / 120;

function run(p: RapierBowling, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) p.step(DT);
}

/** Step until the ball is done and pins have rested for 0.5 s, or `max` seconds. */
function settle(p: RapierBowling, max = 12): number {
  let rest = 0;
  let t = 0;
  while (t < max) {
    p.step(DT);
    t += DT;
    if (p.ballDone() && p.pinsAtRest()) rest += DT;
    else rest = 0;
    if (rest > 0.5) break;
  }
  return t;
}

async function fresh(): Promise<RapierBowling> {
  const p = await createRapierBowling({ ...bowlingConfig });
  p.rack(true);
  return p;
}

describe('rapier bowling physics', () => {
  it('keeps a fresh rack standing for 3 seconds', async () => {
    const p = await fresh();
    run(p, 3);
    expect(p.standingCount()).toBe(10);
    p.dispose();
  });

  it('knocks down at least 6 with a fast centred ball', async () => {
    const p = await fresh();
    p.launch(0, 8, 0, 0);
    settle(p);
    expect(p.standingCount()).toBeLessThanOrEqual(4);
    p.dispose();
  });

  it('sees no pins down for a gutter ball', async () => {
    const p = await fresh();
    p.launch(0.4, 7, 0.075, 0);
    settle(p);
    expect(p.standingCount()).toBe(10);
    expect(p.ballZ).toBeLessThan(-18);
    p.dispose();
  });

  it('is deterministic for the same release', async () => {
    const a = await fresh();
    const b = await fresh();
    for (const p of [a, b]) {
      p.launch(0.1, 7.5, -0.02, 0.4);
      settle(p);
    }
    expect(a.standingCount()).toBe(b.standingCount());
    expect(a.ballX).toBe(b.ballX);
    expect(a.ballZ).toBe(b.ballZ);
    a.dispose();
    b.dispose();
  });

  it('keeps standing pins where they were for the second ball', async () => {
    const p = await fresh();
    p.launch(0.3, 7, 0, 0);
    settle(p);
    const standing = p.standingCount();
    expect(standing).toBeGreaterThan(0);
    expect(standing).toBeLessThan(10);
    const out = new Float64Array(7);
    const before: number[][] = [];
    for (let i = 0; i < 10; i++) {
      p.readPin(i, 1, out);
      before.push(Array.from(out));
    }
    const standingIdx: number[] = [];
    for (let i = 0; i < 10; i++) if (p.pinPresent[i] && !p.pinDown(i)) standingIdx.push(i);
    p.removeBall();
    p.rack(false);
    run(p, 0.5);
    expect(p.standingCount()).toBe(standing);
    for (let i = 0; i < 10; i++) expect(p.pinPresent[i]).toBe(standingIdx.includes(i));
    for (const i of standingIdx) {
      p.readPin(i, 1, out);
      expect(out[0]).toBeCloseTo((before[i] as number[])[0] as number, 3);
      expect(out[2]).toBeCloseTo((before[i] as number[])[2] as number, 3);
    }
    p.dispose();
  });

  it('hooks toward the hook sign late in the lane', async () => {
    const p = await fresh();
    p.rack(false);
    p.launch(0, 7, 0, 0.7);
    run(p, 3.2);
    const right = p.ballX;
    p.launch(0, 7, 0, -0.7);
    run(p, 3.2);
    expect(right).toBeGreaterThan(0.02);
    expect(p.ballX).toBeLessThan(-0.02);
    p.dispose();
  });
});
