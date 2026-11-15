// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  DWELL_MS,
  DwellTracker,
  HandChooser,
  HandCursor,
  SCREEN_GUARD_MS,
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
  function setup() {
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
    return { host, button, cursor, click, input };
  }

  it('selects the button under the hand after the dwell and shows hover', () => {
    const { host, button, cursor, click, input } = setup();
    input.setMouse(0.05, 0.05, false);
    let t = 0;
    cursor.update(input.state, 0.016, t);
    expect(cursor.el.hidden).toBe(false);
    // the hand has been seen outside every button; it then moves onto one after the guard
    for (; t < SCREEN_GUARD_MS; t += 16) cursor.update(input.state, 0.016, t);
    input.setMouse(0.5, 0.5, false);
    while (!button.classList.contains('hovered') && t < SCREEN_GUARD_MS + 1000) {
      t += 16;
      cursor.update(input.state, 0.016, t);
    }
    expect(button.classList.contains('hovered')).toBe(true);
    const start = t;
    for (; t < start + DWELL_MS - 50; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).not.toHaveBeenCalled();
    for (; t < start + DWELL_MS + 100; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    for (; t < start + DWELL_MS + 400; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    cursor.dispose();
    host.remove();
  });

  it('cannot begin a dwell in the first 1200 ms of a screen, even after leaving the buttons', () => {
    const { host, button, cursor, click, input } = setup();
    input.setMouse(0.05, 0.05, false);
    cursor.update(input.state, 0.016, 0);
    input.setMouse(0.5, 0.5, false);
    let t = 16;
    for (; t < SCREEN_GUARD_MS; t += 16) cursor.update(input.state, 0.016, t);
    expect(button.classList.contains('hovered')).toBe(false);
    cursor.update(input.state, 0.016, t);
    expect(button.classList.contains('hovered')).toBe(true);
    const start = t;
    for (; t < start + DWELL_MS + 50; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    cursor.dispose();
    host.remove();
  });

  it('a hand resting on a new button never selects it until it has left every button', () => {
    const { host, cursor, click, input } = setup();
    input.setMouse(0.5, 0.5, false);
    let t = 0;
    for (; t < 6000; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).not.toHaveBeenCalled();
    input.setMouse(0.05, 0.05, false); // leaves: now seen outside
    for (; t < 6200; t += 16) cursor.update(input.state, 0.016, t);
    input.setMouse(0.5, 0.5, false);
    for (; t < 6200 + DWELL_MS + 600; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    cursor.dispose();
    host.remove();
  });

  it('a hand that was lowered for the guard time may then dwell, and a new screen re-arms the guard', () => {
    const { host, button, cursor, click, input } = setup();
    let t = 0;
    for (; t < SCREEN_GUARD_MS + 100; t += 16) cursor.update(input.state, 0.016, t); // no hand
    input.setMouse(0.5, 0.5, false);
    const start = t;
    for (; t < start + DWELL_MS + 100; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).toHaveBeenCalledTimes(1);
    cursor.setButtons([button]); // new screen
    for (let u = 0; u < 3000; u += 16, t += 16) cursor.update(input.state, 0.016, t);
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

describe('HandCursor pointer mode (mouse)', () => {
  function move(x: number, y: number, buttons = 0): void {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, buttons }));
  }

  function setup() {
    const host = document.createElement('div');
    document.body.append(host);
    const button = document.createElement('button');
    host.append(button);
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 200, height: 80 }) as DOMRect;
    const cursor = new HandCursor(host);
    cursor.setButtons([button]);
    cursor.setPointerMode(true);
    const click = vi.fn();
    button.addEventListener('click', click);
    const input = createFakeInput('pose', 'debug');
    return { host, button, cursor, click, input };
  }

  it('is hidden until the pointer moves, then sits exactly on clientX/clientY', () => {
    const { host, cursor, input } = setup();
    cursor.update(input.state, 0.016, 0);
    expect(cursor.el.hidden).toBe(true);
    for (const [x, y] of [
      [333, 271],
      [1020, 90],
      [0, 719],
    ] as const) {
      move(x, y);
      cursor.update(input.state, 0.016, 16);
      expect(cursor.el.hidden).toBe(false);
      expect(cursor.el.style.left).toBe(`${x}px`);
      expect(cursor.el.style.top).toBe(`${y}px`);
    }
    cursor.dispose();
    host.remove();
  });

  it('ignores the tracked hand entirely', () => {
    const { host, cursor, input } = setup();
    input.setMouse(0.9, 0.9, true);
    move(50, 60);
    cursor.update(input.state, 0.016, 0);
    expect(cursor.el.style.left).toBe('50px');
    expect(cursor.el.style.top).toBe('60px');
    cursor.dispose();
    host.remove();
  });

  it('never selects by hovering, however long', () => {
    const { host, button, cursor, click, input } = setup();
    move(10, 10);
    for (let t = 0; t < 1000; t += 16) cursor.update(input.state, 0.016, t);
    move(200, 140);
    for (let t = 1000; t < 8000; t += 16) cursor.update(input.state, 0.016, t);
    expect(click).not.toHaveBeenCalled();
    expect(button.classList.contains('hovered')).toBe(false);
    cursor.dispose();
    host.remove();
  });

  it('closes the mitt while a button is held down', () => {
    const { host, cursor, input } = setup();
    move(10, 10, 1);
    cursor.update(input.state, 0.016, 0);
    expect(cursor.el.classList.contains('closed')).toBe(true);
    move(10, 10, 0);
    cursor.update(input.state, 0.016, 16);
    expect(cursor.el.classList.contains('closed')).toBe(false);
    cursor.dispose();
    host.remove();
  });

  it('switching back to hand mode stops listening to the pointer', () => {
    const { host, cursor, input } = setup();
    cursor.setPointerMode(false);
    move(300, 300);
    cursor.update(input.state, 0.016, 0);
    expect(cursor.el.style.left).not.toBe('300px');
    expect(cursor.el.style.top).not.toBe('300px');
    cursor.dispose();
    host.remove();
  });
});

describe('HandCursor reveal-near mode', () => {
  it('shows the mitt only while the hand is near a button', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const button = document.createElement('button');
    host.append(button);
    const w = window.innerWidth;
    const h = window.innerHeight;
    button.getBoundingClientRect = () =>
      ({ left: w / 2 - 100, top: h / 2 - 40, width: 200, height: 80 }) as DOMRect;
    const cursor = new HandCursor(host);
    cursor.setRevealNear(true);
    cursor.setButtons([button]);
    const input = createFakeInput('hands');
    input.setMouse(0.05, 0.05, false);
    let t = 0;
    for (; t < 400; t += 16) cursor.update(input.state, 0.016, t);
    expect(cursor.el.hidden).toBe(true);
    input.setMouse(0.5, 0.5, false);
    for (; t < 800; t += 16) cursor.update(input.state, 0.016, t);
    expect(cursor.el.hidden).toBe(false);
    input.setMouse(0.05, 0.05, false);
    for (; t < 1200; t += 16) cursor.update(input.state, 0.016, t);
    expect(cursor.el.hidden).toBe(true);
    cursor.dispose();
    host.remove();
  });
});
