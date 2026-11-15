import { describe, expect, it } from 'vitest';
import { archeryConfig } from './config';
import { StepEvent } from './draw';
import { MouseDraw } from './mouseDraw';

const DT = 1 / 120;
const cfg = archeryConfig;

/** Run `ms` of holding the button with the given counters; returns the last event. */
function hold(m: MouseDraw, ms: number, presses: number, releases: number): number {
  let ev: number = StepEvent.None;
  for (let t = 0; t < ms; t += DT * 1000) {
    const e = m.step(DT, true, presses, releases, 0.1, 0.05);
    if (e !== StepEvent.None) ev = e;
  }
  return ev;
}

describe('MouseDraw', () => {
  it('nocks and starts drawing on the press itself', () => {
    const m = new MouseDraw(cfg);
    expect(m.step(DT, true, 1, 0, 0, 0)).toBe(StepEvent.Nock);
    expect(m.phase).toBe('drawing');
    expect(m.draw).toBeGreaterThan(0);
  });

  it('grows with hold time, reaches full at mouseDrawS and stays there', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    hold(m, cfg.mouseDrawS * 500, 1, 0);
    expect(m.draw).toBeGreaterThan(0.4);
    expect(m.draw).toBeLessThan(0.6);
    hold(m, cfg.mouseDrawS * 1000, 1, 0);
    expect(m.draw).toBe(1);
    hold(m, 2000, 1, 0);
    expect(m.draw).toBe(1);
    expect(m.holdFullS).toBeGreaterThan(2);
  });

  it('release shoots with the draw reached and the aim at that moment', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    hold(m, 400, 1, 0);
    const drawn = m.draw;
    expect(m.step(DT, false, 1, 1, 0.07, -0.02)).toBe(StepEvent.Shot);
    expect(m.phase).toBe('locked');
    expect(m.shot.draw).toBeGreaterThanOrEqual(drawn);
    expect(m.shot.draw).toBeLessThan(0.75);
    expect(m.shot.yaw).toBe(0.07);
    expect(m.shot.pitch).toBe(-0.02);
  });

  it('a tap shorter than the minimum draw puts the arrow back with a hint, never stuck', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    expect(m.step(DT, false, 1, 1, 0, 0)).toBe(StepEvent.Unnock);
    expect(m.phase).toBe('ready');
    expect(m.hint).toBe('further');
    // The next press works at once.
    expect(m.step(DT, true, 2, 1, 0, 0)).toBe(StepEvent.Nock);
  });

  it('a press and release inside one update is a tap, not a stuck nock', () => {
    const m = new MouseDraw(cfg);
    expect(m.step(DT, false, 1, 1, 0, 0)).toBe(StepEvent.Unnock);
    expect(m.phase).toBe('ready');
  });

  it('the further hint expires', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, false, 1, 1, 0, 0);
    for (let t = 0; t < cfg.furtherHintMs + 100; t += DT * 1000) m.step(DT, false, 1, 1, 0, 0);
    expect(m.hint).toBe('nock');
  });

  it('ignores presses while locked, and a press kept during flight draws once ready and held', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    hold(m, 500, 1, 0);
    m.step(DT, false, 1, 1, 0, 0);
    expect(m.step(DT, true, 2, 1, 0, 0)).toBe(StepEvent.None);
    expect(m.phase).toBe('locked');
    m.unlock();
    expect(m.step(DT, true, 2, 1, 0, 0)).toBe(StepEvent.Nock);
  });

  it('drops a kept press that was let go before the next arrow was ready', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    hold(m, 500, 1, 0);
    m.step(DT, false, 1, 1, 0, 0);
    m.step(DT, true, 2, 1, 0, 0);
    m.step(DT, false, 2, 2, 0, 0);
    m.unlock();
    expect(m.step(DT, false, 2, 2, 0, 0)).toBe(StepEvent.None);
    expect(m.phase).toBe('ready');
  });

  it('cancel after a pause drops the draw and does not shoot on the stale release', () => {
    const m = new MouseDraw(cfg);
    m.step(DT, true, 1, 0, 0, 0);
    hold(m, 500, 1, 0);
    m.cancel(1, 1);
    expect(m.phase).toBe('ready');
    expect(m.draw).toBe(0);
    expect(m.step(DT, false, 1, 1, 0, 0)).toBe(StepEvent.None);
    expect(m.step(DT, true, 2, 1, 0, 0)).toBe(StepEvent.Nock);
  });
});
