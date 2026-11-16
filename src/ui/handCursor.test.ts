// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  FIST_CONFIRM_MS,
  FistTracker,
  HandCursor,
  SCREEN_GUARD_MS,
  LOCKOUT_MS,
  SmoothPoint,
  hitTest,
  mapReach,
} from './handCursor';
import type { FistState } from './handCursor';
import { createFakeInput } from './harness/fakeInput';
import type { FakeInput } from './harness/fakeInput';
import type { Side } from '../input/types';

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

describe('FistTracker', () => {
  const run = (
    t: FistTracker,
    hovered: number,
    fist: FistState,
    from: number,
    ms: number,
  ): number => {
    let fired = -1;
    for (let now = from; now <= from + ms; now += 16) {
      const r = t.update(hovered, fist, now);
      if (r >= 0) fired = r;
    }
    return fired;
  };

  it('an open hand over a button never selects, however long', () => {
    const t = new FistTracker();
    expect(run(t, 2, 'open', 0, 5000)).toBe(-1);
    expect(t.target).toBe(2);
    expect(t.progress).toBe(0);
  });

  it('open then closed over the same button selects once after the confirm time', () => {
    const t = new FistTracker();
    run(t, 1, 'open', 0, 200);
    expect(t.update(1, 'closed', 1000)).toBe(-1);
    expect(t.update(1, 'closed', 1000 + FIST_CONFIRM_MS / 2)).toBe(-1);
    expect(t.progress).toBeCloseTo(0.5, 2);
    expect(t.update(1, 'closed', 1000 + FIST_CONFIRM_MS)).toBe(1);
    expect(t.progress).toBe(0);
  });

  it('a fist that was already closed when it arrived never selects', () => {
    const t = new FistTracker();
    expect(run(t, 1, 'closed', 0, 5000)).toBe(-1);
  });

  it('a closed fist sliding from one button to another does not select there', () => {
    const t = new FistTracker();
    run(t, 0, 'open', 0, 200);
    run(t, 0, 'closed', 216, 100); // closing on 0, not yet confirmed
    expect(run(t, 1, 'closed', 400, 3000)).toBe(-1);
  });

  it('unknown state never selects and wipes the open memory', () => {
    const t = new FistTracker();
    expect(run(t, 1, 'unknown', 0, 3000)).toBe(-1);
    run(t, 1, 'open', 3100, 100);
    run(t, 1, 'unknown', 3300, 100);
    expect(run(t, 1, 'closed', 3500, 2000)).toBe(-1);
  });

  it('opening before the confirm time cancels the press', () => {
    const t = new FistTracker();
    run(t, 1, 'open', 0, 100);
    t.update(1, 'closed', 200);
    t.update(1, 'closed', 200 + FIST_CONFIRM_MS - 20);
    t.update(1, 'open', 200 + FIST_CONFIRM_MS - 4);
    expect(t.progress).toBe(0);
    expect(t.update(1, 'closed', 200 + FIST_CONFIRM_MS + 100)).toBe(-1);
  });

  it('fires once; a held fist never repeats until the hand has opened again', () => {
    const t = new FistTracker();
    run(t, 1, 'open', 0, 100);
    let count = 0;
    for (let now = 200; now < 8000; now += 16) if (t.update(1, 'closed', now) >= 0) count++;
    expect(count).toBe(1);
    run(t, 1, 'open', 8000, 100);
    for (let now = 8200; now < 9000; now += 16) if (t.update(1, 'closed', now) >= 0) count++;
    expect(count).toBe(2);
  });

  it('locks out for 600 ms after a selection, and lock() does the same on request', () => {
    const t = new FistTracker();
    run(t, 0, 'open', 0, 100);
    t.update(0, 'closed', 200);
    expect(t.update(0, 'closed', 200 + FIST_CONFIRM_MS)).toBe(0);
    const at = 200 + FIST_CONFIRM_MS;
    expect(run(t, 0, 'open', at + 16, LOCKOUT_MS - 40)).toBe(-1);
    expect(t.target).toBe(-1);
    t.lock(5000);
    expect(t.target).toBe(-1);
    run(t, 0, 'open', 5000, LOCKOUT_MS - 20);
    expect(t.target).toBe(-1);
    run(t, 0, 'open', 5000 + LOCKOUT_MS, 100);
    expect(t.target).toBe(0);
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

/** Two buttons, A left of centre and B right of centre, and a fake camera input. */
function rig() {
  const host = document.createElement('div');
  document.body.append(host);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const a = document.createElement('button');
  const b = document.createElement('button');
  host.append(a, b);
  a.getBoundingClientRect = () =>
    ({ left: w * 0.25 - 100, top: h / 2 - 40, width: 200, height: 80 }) as DOMRect;
  b.getBoundingClientRect = () =>
    ({ left: w * 0.75 - 100, top: h / 2 - 40, width: 200, height: 80 }) as DOMRect;
  const cursor = new HandCursor(host);
  cursor.setButtons([a, b]);
  const clickA = vi.fn();
  const clickB = vi.fn();
  a.addEventListener('click', clickA);
  b.addEventListener('click', clickB);
  const input: FakeInput = createFakeInput('hands');
  const state = { t: 0 };
  const clicks = (): number => clickA.mock.calls.length + clickB.mock.calls.length;
  const run = (ms: number): void => {
    for (const end = state.t + ms; state.t < end; state.t += 16) {
      cursor.update(input.state, 0.016, state.t);
    }
  };
  const runUntilClick = (maxMs: number): void => {
    for (const end = state.t + maxMs; state.t < end && clicks() === 0;) run(16);
  };
  /** Both hands open and out of every button for longer than the screen guard. */
  const arm = (): void => {
    input.setHand('left', 0.5, 0.1, false);
    input.setHand('right', 0.5, 0.9, false);
    run(SCREEN_GUARD_MS + 200);
  };
  /** Move a hand (open) over button A (0.25) or B (0.75) and let the cursor settle there. */
  const open = (side: Side, nx: number): void => {
    input.setHand(side, nx, 0.5, false);
    run(600);
  };
  const fist = (side: Side, nx: number): void => input.setHand(side, nx, 0.5, true);
  const finish = (): void => {
    cursor.dispose();
    host.remove();
  };
  return {
    host,
    a,
    b,
    cursor,
    clickA,
    clickB,
    input,
    state,
    clicks,
    run,
    runUntilClick,
    arm,
    open,
    fist,
    finish,
  };
}

describe('HandCursor', () => {
  it('an open hand shows the cursor and the hover but never selects, however long', () => {
    const { cursor, a, clicks, arm, open, run, finish } = rig();
    arm();
    open('right', 0.25);
    expect(cursor.elements.right.hidden).toBe(false);
    expect(a.classList.contains('hovered')).toBe(true);
    run(5000);
    expect(a.classList.contains('hovered')).toBe(true);
    expect(clicks()).toBe(0);
    finish();
  });

  it('a fist closed over the button selects once, after the confirm time', () => {
    const { a, clickA, clicks, arm, open, fist, run, finish } = rig();
    arm();
    open('left', 0.25);
    fist('left', 0.25);
    run(FIST_CONFIRM_MS - 80);
    expect(clicks()).toBe(0);
    run(200);
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(a.classList.contains('hovered')).toBe(false);
    run(5000); // the fist stays closed: no repeat
    expect(clickA).toHaveBeenCalledTimes(1);
    finish();
  });

  it('shows the ring filling while the fist is confirmed', () => {
    const { cursor, arm, open, fist, run, finish } = rig();
    arm();
    open('right', 0.75);
    const ring = cursor.elements.right.querySelector('.hc-ring') as SVGElement;
    const before = ring.getAttribute('stroke-dashoffset');
    fist('right', 0.75);
    run(FIST_CONFIRM_MS / 2);
    expect(ring.getAttribute('stroke-dashoffset')).not.toBe(before);
    finish();
  });

  it('a fist already closed that slides onto a button does not select it', () => {
    const { clicks, arm, fist, run, finish } = rig();
    arm();
    fist('right', 0.5); // closed in the gap, then slides onto B
    run(300);
    fist('right', 0.75);
    run(4000);
    expect(clicks()).toBe(0);
    finish();
  });

  it('a hand with an unknown fist state hovers but never selects', () => {
    const { input, a, clicks, arm, open, fist, run, finish } = rig();
    arm();
    open('left', 0.25);
    input.setKnown('left', false);
    fist('left', 0.25); // the stand-in says closed, but it is not confident
    input.setKnown('left', false);
    run(4000);
    expect(a.classList.contains('hovered')).toBe(true);
    expect(clicks()).toBe(0);
    finish();
  });

  it('cannot select in the first 1200 ms of a screen, even after leaving the buttons', () => {
    const { clicks, input, fist, run, finish } = rig();
    input.setHand('right', 0.5, 0.9, false);
    run(16);
    input.setHand('right', 0.75, 0.5, false);
    run(500);
    fist('right', 0.75);
    run(500); // still inside the guard
    expect(clicks()).toBe(0);
    finish();
  });

  it("a hand resting on a new screen's button never selects it until it has left every button", () => {
    const { cursor, a, b, clicks, arm, open, fist, run, finish } = rig();
    arm();
    open('left', 0.25);
    cursor.setButtons([a, b]); // new screen, the hand is resting on A
    fist('left', 0.25);
    run(SCREEN_GUARD_MS + 1500);
    expect(clicks()).toBe(0);
    open('left', 0.5); // leaves every button
    open('left', 0.25);
    fist('left', 0.25);
    run(500);
    expect(clicks()).toBe(1);
    finish();
  });

  it('a hand lowered for the guard time may then select, and a new screen re-arms the guard', () => {
    const { cursor, a, b, clicks, run, input, open, fist, finish } = rig();
    run(SCREEN_GUARD_MS + 100); // no hands at all
    open('right', 0.75);
    fist('right', 0.75);
    run(500);
    expect(clicks()).toBe(1);
    cursor.setButtons([a, b]);
    input.setHand('right', 0.75, 0.5, false);
    run(300);
    fist('right', 0.75);
    run(3000);
    expect(clicks()).toBe(1);
    finish();
  });

  it('hides when no hand is visible', () => {
    const { cursor, run, finish } = rig();
    run(100);
    expect(cursor.elements.left.hidden).toBe(true);
    expect(cursor.elements.right.hidden).toBe(true);
    finish();
  });

  it('a closed fist shows the mitt closed', () => {
    const { cursor, arm, open, fist, run, finish } = rig();
    arm();
    open('right', 0.75);
    expect(cursor.elements.right.classList.contains('closed')).toBe(false);
    fist('right', 0.75);
    run(32);
    expect(cursor.elements.right.classList.contains('closed')).toBe(true);
    finish();
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

describe('HandCursor suspended (active play)', () => {
  it('hides, never hovers and never selects while suspended, whatever the hands do', () => {
    const { cursor, a, clicks, arm, input, fist, run, finish } = rig();
    arm();
    cursor.setSuspended(true);
    input.setHand('right', 0.25, 0.5, false);
    run(600);
    fist('right', 0.25);
    run(3000);
    expect(cursor.elements.right.hidden).toBe(true);
    expect(cursor.elements.left.hidden).toBe(true);
    expect(a.classList.contains('hovered')).toBe(false);
    expect(clicks()).toBe(0);
    finish();
  });

  it('a hand resting on a button when play ends does not select it at once', () => {
    const { cursor, a, clicks, arm, open, fist, run, finish } = rig();
    arm();
    cursor.setSuspended(true);
    open('right', 0.25);
    run(2000);
    cursor.setSuspended(false);
    fist('right', 0.25);
    run(3000);
    expect(clicks()).toBe(0);
    // after moving off, opening and closing over it again it works
    open('right', 0.5);
    run(200);
    open('right', 0.25);
    fist('right', 0.25);
    run(600);
    expect(clicks()).toBe(1);
    expect(a.classList.contains('hovered')).toBe(false);
    finish();
  });

  it('does not change pointer (mouse) mode', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const button = document.createElement('button');
    host.append(button);
    button.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 200, height: 80 }) as DOMRect;
    const cursor = new HandCursor(host);
    cursor.setButtons([button]);
    cursor.setPointerMode(true);
    cursor.setSuspended(true);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 120 }));
    cursor.update(createFakeInput('pose', 'debug').state, 0.016, 0);
    expect(cursor.el.hidden).toBe(false);
    expect(cursor.el.style.left).toBe('150px');
    cursor.dispose();
    host.remove();
  });
});

describe('HandCursor two hands', () => {
  const pct = (el: HTMLElement, prop: 'left' | 'top'): number => parseFloat(el.style[prop]) / 100;

  it('gives each tracked hand its own cursor, tagged L and R', () => {
    const { cursor, input, run, finish } = rig();
    const { left, right } = cursor.elements;
    expect(left).not.toBe(right);
    expect(left.classList.contains('hc-left')).toBe(true);
    expect(right.classList.contains('hc-right')).toBe(true);
    expect(left.querySelector('.hc-tag')?.textContent).toBe('L');
    expect(right.querySelector('.hc-tag')?.textContent).toBe('R');
    run(32);
    expect(left.hidden).toBe(true);
    expect(right.hidden).toBe(true);
    input.setHand('left', 0.2, 0.2, false);
    run(32);
    expect(left.hidden).toBe(false);
    expect(right.hidden).toBe(true);
    input.setHand('right', 0.8, 0.8, false);
    run(32);
    expect(right.hidden).toBe(false);
    finish();
  });

  it('each cursor follows only its own hand, with no cross-talk when one is lost and returns', () => {
    const { cursor, input, run, finish } = rig();
    const { left, right } = cursor.elements;
    input.setHand('left', 0.2, 0.2, false);
    input.setHand('right', 0.8, 0.8, false);
    run(600);
    expect(pct(left, 'left')).toBeCloseTo(0.2, 1);
    expect(pct(left, 'top')).toBeCloseTo(0.2, 1);
    expect(pct(right, 'left')).toBeCloseTo(0.8, 1);
    expect(pct(right, 'top')).toBeCloseTo(0.8, 1);
    // the hands cross over: the cursors stay with their own hand and do not swap
    input.setHand('left', 0.9, 0.3, false);
    input.setHand('right', 0.1, 0.7, false);
    run(800);
    expect(pct(left, 'left')).toBeCloseTo(0.9, 1);
    expect(pct(right, 'left')).toBeCloseTo(0.1, 1);
    // the left hand is lost: only its cursor goes, the right one keeps following
    input.clearHand('left');
    input.setHand('right', 0.6, 0.5, false);
    run(600);
    expect(left.hidden).toBe(true);
    expect(right.hidden).toBe(false);
    expect(pct(right, 'left')).toBeCloseTo(0.6, 1);
    // it comes back somewhere else and appears right there, not where the other hand is
    input.setHand('left', 0.3, 0.4, false);
    run(16);
    expect(left.hidden).toBe(false);
    expect(pct(left, 'left')).toBeCloseTo(0.3, 2);
    expect(pct(left, 'top')).toBeCloseTo(0.4, 2);
    expect(pct(right, 'left')).toBeCloseTo(0.6, 1);
    finish();
  });

  it('either hand can select with a fist', () => {
    for (const side of ['left', 'right'] as const) {
      const { arm, open, fist, run, clickA, clickB, finish } = rig();
      arm();
      open(side, 0.75);
      fist(side, 0.75);
      run(600);
      expect(clickB).toHaveBeenCalledTimes(1);
      expect(clickA).not.toHaveBeenCalled();
      finish();
    }
  });

  it('only the hand making a fist selects; the other, open over a button, does nothing', () => {
    const { arm, open, fist, run, clickA, clickB, a, finish } = rig();
    arm();
    open('left', 0.25); // open over A
    open('right', 0.75);
    fist('right', 0.75); // fist over B
    run(600);
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickA).not.toHaveBeenCalled();
    run(3000);
    expect(clickA).not.toHaveBeenCalled();
    // the open hand keeps its hover highlight; the hand that selected is locked out
    expect(a.classList.contains('hovered')).toBe(true);
    expect(clickB).toHaveBeenCalledTimes(1); // the held fist does not repeat
    finish();
  });

  it('a fist on one button while the other hand moves around elsewhere still selects it', () => {
    const { arm, open, fist, run, state, input, clickA, clickB, finish } = rig();
    arm();
    open('left', 0.25);
    fist('left', 0.25);
    for (const end = state.t + 600; state.t < end; run(16)) {
      // the right hand wanders along the bottom, never over a button
      input.setHand('right', 0.3 + 0.4 * Math.abs(Math.sin(state.t / 400)), 0.92, false);
    }
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(clickB).not.toHaveBeenCalled();
    finish();
  });

  it('both hands making a fist on one button activate it once', () => {
    const { arm, open, fist, run, clickA, a, finish } = rig();
    arm();
    open('left', 0.24);
    open('right', 0.26);
    expect(a.classList.contains('hovered')).toBe(true);
    fist('left', 0.24);
    fist('right', 0.26);
    run(1500);
    expect(clickA).toHaveBeenCalledTimes(1);
    finish();
  });

  it('on different buttons the first to complete wins and the other press is cancelled', () => {
    const { arm, open, fist, run, runUntilClick, clickA, clickB, a, b, finish } = rig();
    arm();
    open('left', 0.25);
    open('right', 0.75);
    fist('right', 0.75); // right closes first
    run(100);
    fist('left', 0.25); // left closes a little later, still holding it closed
    runUntilClick(2000);
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickA).not.toHaveBeenCalled();
    expect(a.classList.contains('hovered')).toBe(false);
    expect(b.classList.contains('hovered')).toBe(false);
    // the cancelled hand keeps its fist closed: it must open again before it can select
    run(LOCKOUT_MS + 3000);
    expect(clickA).not.toHaveBeenCalled();
    open('left', 0.25);
    fist('left', 0.25);
    run(600);
    expect(clickA).toHaveBeenCalledTimes(1);
    finish();
  });

  it('after a selection both hands need the guard and to be seen open again', () => {
    const { cursor, a, b, input, clicks, arm, open, fist, run, finish } = rig();
    arm();
    open('left', 0.25);
    open('right', 0.75);
    fist('left', 0.25);
    run(600);
    expect(clicks()).toBe(1);
    // a new screen: both hands rest on its buttons; the right one even closes its fist there
    cursor.setButtons([a, b]);
    fist('right', 0.75);
    run(3000);
    expect(clicks()).toBe(1);
    // both leave, then the right hand opens and closes over its button
    input.setHand('left', 0.5, 0.9, false);
    input.setHand('right', 0.5, 0.9, false);
    run(400);
    open('right', 0.75);
    fist('right', 0.75);
    run(600);
    expect(clicks()).toBe(2);
    finish();
  });

  it('pointer mode stays a single cursor on the pointer, with no L or R mark', () => {
    const { cursor, input, run, finish } = rig();
    cursor.setPointerMode(true);
    input.setHand('left', 0.25, 0.5, false);
    input.setHand('right', 0.75, 0.5, false);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 50 }));
    run(32);
    expect(cursor.elements.left.hidden).toBe(true);
    expect(cursor.el.hidden).toBe(false);
    expect(cursor.el.style.left).toBe('40px');
    expect(cursor.el.classList.contains('hc-pointer')).toBe(true);
    cursor.setPointerMode(false);
    expect(cursor.el.classList.contains('hc-pointer')).toBe(false);
    finish();
  });
});
