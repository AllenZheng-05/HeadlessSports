// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  DWELL_MS,
  DwellTracker,
  HandChooser,
  HandCursor,
  LOCKOUT_MS,
  SmoothPoint,
  hitTest,
  mapReach,
} from './handCursor';
import { createFakeInput } from './harness/fakeInput';

const p = { x: 0, y: 0 };

describe('mapReach', () => {
  it('puts a hand above the shoulder centre in the middle of the screen horizontally', () => {
    mapReach(p, true, 16 / 9, 0.3, 0.5, 0.4, 0.5, 0.3);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5 - (0.1 / 0.3 - 0.2) / 2.2, 6);
  });

  it('scales x by aspect over three shoulder widths', () => {
    const aspect = 2;
    const sw = 0.3;
    mapReach(p, true, aspect, sw, 0.5, 0.4, 0.5 + 0.1, 0.4);
    expect(p.x).toBeCloseTo(0.5 + (0.1 * aspect) / (sw * 3), 6);
  });

  it('clamps to 0..1', () => {
    mapReach(p, true, 16 / 9, 0.3, 0.5, 0.4, 5, -5);
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
    mapReach(p, true, 16 / 9, 0.3, 0.5, 0.4, -5, 5);
    expect(p.x).toBe(0);
    expect(p.y).toBe(1);
  });

  it('expands the palm about the centre by 1.3 for hands-only tracking', () => {
    mapReach(p, false, 16 / 9, 0, 0, 0, 0.6, 0.4);
    expect(p.x).toBeCloseTo(0.63, 6);
    expect(p.y).toBeCloseTo(0.37, 6);
    mapReach(p, false, 16 / 9, 0, 0, 0, 1, 0);
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
  });
});

describe('HandChooser', () => {
  it('starts with the higher hand', () => {
    const c = new HandChooser();
    expect(c.update(true, 0.5, true, 0.3, 0.3, 0)).toBe('right');
  });

  it('uses the only visible hand, and none when neither', () => {
    const c = new HandChooser();
    expect(c.update(true, 0.5, false, 0, 0.3, 0)).toBe('left');
    expect(c.update(false, 0, true, 0.2, 0.3, 10)).toBe('right');
    expect(c.update(false, 0, false, 0, 0.3, 20)).toBeNull();
  });

  it('switches only after the other hand has been clearly higher for 300 ms', () => {
    const c = new HandChooser();
    c.update(true, 0.5, true, 0.3, 0.3, 0); // right
    expect(c.update(true, 0.2, true, 0.3, 0.3, 100)).toBe('right'); // challenge starts
    expect(c.update(true, 0.2, true, 0.3, 0.3, 350)).toBe('right'); // 250 ms: not yet
    expect(c.update(true, 0.2, true, 0.3, 0.3, 420)).toBe('left'); // 320 ms: switched
  });

  it('restarts the timer when the margin is lost', () => {
    const c = new HandChooser();
    c.update(true, 0.5, true, 0.3, 0.3, 0); // right
    c.update(true, 0.2, true, 0.3, 0.3, 100); // challenge
    c.update(true, 0.31, true, 0.3, 0.3, 300); // margin lost: reset
    expect(c.update(true, 0.2, true, 0.3, 0.3, 500)).toBe('right');
    expect(c.update(true, 0.2, true, 0.3, 0.3, 700)).toBe('right');
    expect(c.update(true, 0.2, true, 0.3, 0.3, 810)).toBe('left');
  });

  it('needs 0.15 shoulder widths of margin', () => {
    const c = new HandChooser();
    c.update(true, 0.5, true, 0.3, 0.4, 0); // right at 0.3
    c.update(true, 0.25, true, 0.3, 0.4, 100); // left higher by 0.05 < 0.06
    expect(c.update(true, 0.25, true, 0.3, 0.4, 1000)).toBe('right');
  });
});

describe('DwellTracker', () => {
  it('fills over the dwell time and completes once', () => {
    const d = new DwellTracker();
    expect(d.update(2, 0)).toBe(-1);
    expect(d.update(2, DWELL_MS / 2)).toBe(-1);
    expect(d.progress).toBeCloseTo(0.5, 2);
    expect(d.update(2, DWELL_MS)).toBe(2);
    expect(d.progress).toBe(0);
  });

  it('resets when the cursor leaves or moves to another target', () => {
    const d = new DwellTracker();
    d.update(1, 0);
    d.update(1, 800);
    expect(d.update(-1, 900)).toBe(-1);
    expect(d.progress).toBe(0);
    d.update(1, 1000);
    d.update(3, 1900);
    expect(d.update(3, 1900 + DWELL_MS - 1)).toBe(-1);
    expect(d.update(3, 1900 + DWELL_MS)).toBe(3);
  });

  it('locks out for 600 ms after a selection', () => {
    const d = new DwellTracker();
    d.update(0, 0);
    expect(d.update(0, DWELL_MS)).toBe(0);
    const t = DWELL_MS;
    expect(d.update(1, t + 100)).toBe(-1);
    expect(d.update(1, t + LOCKOUT_MS - 1)).toBe(-1);
    expect(d.target).toBe(-1);
    expect(d.update(1, t + LOCKOUT_MS)).toBe(-1);
    expect(d.update(1, t + LOCKOUT_MS + DWELL_MS - 1)).toBe(-1);
    expect(d.update(1, t + LOCKOUT_MS + DWELL_MS)).toBe(1);
  });
});

describe('SmoothPoint', () => {
  it('converges without overshoot', () => {
    const s = new SmoothPoint();
    s.snap(0, 0);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      s.step(1, 1, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeGreaterThan(0.999);
    expect(max).toBeLessThanOrEqual(1.0001);
  });

  it('is mostly there within a quarter of a second', () => {
    const s = new SmoothPoint();
    s.snap(0, 0);
    for (let i = 0; i < 15; i++) s.step(1, 0, 1 / 60);
    expect(s.x).toBeGreaterThan(0.8);
  });
});

describe('hitTest', () => {
  const rects = new Float32Array([100, 100, 200, 80, 400, 100, 200, 80]);
  it('finds the rect, with forgiveness', () => {
    expect(hitTest(rects, 2, 150, 120, 12)).toBe(0);
    expect(hitTest(rects, 2, 95, 95, 12)).toBe(0);
    expect(hitTest(rects, 2, 450, 150, 12)).toBe(1);
    expect(hitTest(rects, 2, 340, 150, 12)).toBe(-1);
  });
});

describe('HandCursor', () => {
  it('selects the button under the hand after the dwell and shows hover', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const button = document.createElement('button');
    host.append(button);
    const w = window.innerWidth;
    const h = window.innerHeight;
    button.getBoundingClientRect = () =>
      ({ left: w / 2 - 100, top: h / 2 - 40, width: 200, height: 80 }) as DOMRect;
    const cursor = new HandCursor(host);
    cursor.setButtons([button]);
    const click = vi.fn();
    button.addEventListener('click', click);
    const input = createFakeInput('hands');
    input.setMouse(0.5, 0.5, false);

    let t = 0;
    cursor.update(input.state, 0.016, t);
    expect(cursor.el.hidden).toBe(false);
    expect(button.classList.contains('hovered')).toBe(true);
    for (; t < DWELL_MS - 50; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).not.toHaveBeenCalled();
    for (; t < DWELL_MS + 100; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    for (; t < DWELL_MS + 400; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    cursor.dispose();
    host.remove();
  });

  it('hides when no hand is visible', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const button = document.createElement('button');
    host.append(button);
    const cursor = new HandCursor(host);
    cursor.setButtons([button]);
    const input = createFakeInput('hands');
    cursor.update(input.state, 0.016, 0);
    expect(cursor.el.hidden).toBe(true);
    cursor.dispose();
    host.remove();
  });
});
