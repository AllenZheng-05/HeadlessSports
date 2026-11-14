import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameLoop } from './loop';

function harness(options?: { timeScale?: number; maxStepsPerFrame?: number }) {
  const log: string[] = [];
  const calls = {
    begin: [] as [number, number][],
    fixed: 0,
    frame: [] as [number, number, number][],
  };
  const loop = new GameLoop(
    {
      begin(now, dt) {
        log.push('begin');
        calls.begin.push([now, dt]);
      },
      fixed() {
        log.push('fixed');
        calls.fixed++;
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
});
