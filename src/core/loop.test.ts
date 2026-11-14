import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameLoop } from './loop';

function harness(options?: { timeScale?: number; maxStepsPerFrame?: number }) {
  const log: string[] = [];
  const calls = {
    begin: [] as [number, number][],
    fixed: 0,
    sim: [] as number[],
    frame: [] as [number, number, number][],
  };
  const loop = new GameLoop(
    {
      begin(now, dt) {
        log.push('begin');
        calls.begin.push([now, dt]);
      },
      fixed(_dt, simMs) {
        log.push('fixed');
        calls.fixed++;
        calls.sim.push(simMs);
      },
      frame(dt, now, alpha) {
        log.push('frame');
        calls.frame.push([dt, now, alpha]);
      },
    },
    options,
  );
  return { loop, calls, log };
}

describe('GameLoop', () => {
  it('runs begin, fixed x N, frame in order', () => {
    const { loop, log } = harness();
    loop.tick(1000 / 30);
    expect(log).toEqual(['begin', 'fixed', 'fixed', 'fixed', 'fixed', 'frame']);
  });

  it('takes the right number of fixed steps and reports the leftover as alpha', () => {
    const { loop, calls } = harness();
    loop.tick(10);
    expect(calls.fixed).toBe(1);
    expect(calls.frame[0]![2]).toBeCloseTo((0.01 - FIXED_DT) / FIXED_DT, 6);
    loop.tick(10);
    expect(calls.fixed).toBe(2); // 20 ms total = 2.4 steps
  });

  it('scales game time', () => {
    const { loop, calls } = harness({ timeScale: 2 });
    loop.tick(10);
    expect(calls.begin[0]![1]).toBeCloseTo(0.02, 9);
    expect(calls.fixed).toBe(2);
    expect(loop.nowMs).toBe(20);
    loop.tick(10);
    expect(loop.nowMs).toBe(40);
  });

  it('uses the real timeline at timeScale 1', () => {
    const { loop } = harness();
    loop.tick(16);
    loop.tick(17);
    expect(loop.nowMs).toBe(33);
  });

  it('clamps long frames to 100 ms and caps steps without spiralling', () => {
    const { loop, calls } = harness();
    loop.tick(5000);
    expect(calls.begin[0]![1]).toBeCloseTo(0.1, 9);
    expect(calls.fixed).toBeLessThanOrEqual(12);
    const capped = harness({ maxStepsPerFrame: 3 });
    capped.loop.tick(50);
    expect(capped.calls.fixed).toBe(3);
    expect(capped.calls.frame[0]![2]).toBe(0); // remainder dropped
    capped.loop.tick(8.34);
    expect(capped.calls.fixed).toBe(4); // no backlog carried over
  });

  it('defaults the step cap to 12 x timeScale', () => {
    const { loop, calls } = harness({ timeScale: 4 });
    loop.tick(100); // 0.4 s of game time = 48 steps, cap 48
    expect(calls.fixed).toBe(48);
  });

  it('while paused runs begin and frame with dt 0 and no fixed steps', () => {
    const { loop, calls } = harness();
    loop.tick(16);
    const before = calls.fixed;
    loop.paused = true;
    loop.tick(50);
    expect(calls.fixed).toBe(before);
    expect(calls.begin[1]![1]).toBe(0);
    expect(calls.frame[1]![0]).toBe(0);
    loop.paused = false;
    loop.tick(10);
    expect(calls.fixed).toBe(before + 1); // no burst of catch-up steps
  });

  describe('simulation clock', () => {
    const STEP_MS = FIXED_DT * 1000;

    it('gives each substep a strictly increasing time, 8.333 ms apart', () => {
      const { loop, calls } = harness();
      loop.tick(16);
      loop.tick(33);
      loop.tick(5);
      expect(calls.sim.length).toBeGreaterThan(5);
      for (let i = 1; i < calls.sim.length; i++) {
        expect(calls.sim[i]! - calls.sim[i - 1]!).toBeCloseTo(STEP_MS, 6);
      }
    });

    function checkInvariant(timeScale: number, gaps: number[]) {
      const { loop, calls } = harness({ timeScale, maxStepsPerFrame: 1000 });
      for (const gap of gaps) {
        const before = calls.sim.length;
        loop.tick(gap);
        const alphaMs = calls.frame[calls.frame.length - 1]![2] * STEP_MS;
        const last = calls.sim.length > before ? calls.sim[calls.sim.length - 1]! : null;
        if (last !== null) {
          expect(last).toBeLessThanOrEqual(loop.nowMs + 1e-6);
          expect(loop.nowMs - last).toBeCloseTo(alphaMs, 5);
        }
      }
    }

    it('keeps nowMs - simMs equal to the leftover over irregular frames', () => {
      checkInvariant(1, [16, 7, 33, 4, 21, 9, 50, 12, 16.7, 3, 27]);
    });

    it('keeps the invariant with timeScale 4', () => {
      checkInvariant(4, [16, 7, 33, 4, 21, 9, 12, 16.7, 3, 6]);
    });

    it('re-aligns the clocks after a frame that drops steps', () => {
      const { loop, calls } = harness({ maxStepsPerFrame: 3 });
      loop.tick(10);
      loop.tick(60); // 7 steps wanted, 3 run, rest dropped
      const last = calls.sim[calls.sim.length - 1]!;
      expect(last).toBeLessThan(loop.nowMs);
      loop.tick(8.34); // next frame: 1 step, clock back in step with game time
      const t = calls.sim[calls.sim.length - 1]!;
      expect(t).toBeLessThanOrEqual(loop.nowMs + 1e-6);
      expect(loop.nowMs - t).toBeLessThan(STEP_MS);
    });

    it('does not advance while paused and re-aligns on resume', () => {
      const { loop, calls } = harness();
      loop.tick(16);
      const n = calls.sim.length;
      const lastSim = calls.sim[n - 1]!;
      loop.paused = true;
      loop.tick(50);
      loop.tick(50);
      expect(calls.sim.length).toBe(n);
      loop.paused = false;
      loop.tick(10);
      const t = calls.sim[calls.sim.length - 1]!;
      expect(t).toBeGreaterThan(lastSim);
      expect(t).toBeLessThanOrEqual(loop.nowMs + 1e-6);
      expect(loop.nowMs - t).toBeLessThan(STEP_MS);
    });
  });
});
