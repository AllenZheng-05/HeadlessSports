// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { PoseIndex, POSE_STRIDE } from '../../tracking/types';
import type { GameEvent } from '../types';
import { DEBUG_KEYS, DebugInput, debugInputConfig } from './DebugInput';

function make(target?: EventTarget) {
  const input = new DebugInput({
    target: target ?? new EventTarget(),
    viewport: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
  });
  const events: GameEvent[] = [];
  input.onAny((e) => events.push(e));
  return { input, events };
}

function of<T extends GameEvent['type']>(events: GameEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe('DebugInput events', () => {
  it('delivers events only inside update, in order, with the update time', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyQ');
    input.press('KeyE');
    input.press('KeyP');
    expect(events).toHaveLength(0);
    input.update(100);
    expect(events.map((e) => e.type)).toEqual(['FistClosed', 'FistClosed', 'Punch']);
    expect(events.every((e) => e.t === 100)).toBe(true);
  });

  it('toggles fists and mirrors state', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyQ');
    input.update(10);
    expect(input.state.hands.left.closed).toBe(true);
    expect(input.state.hands.left.curl).toBeCloseTo(0.8);
    input.release('KeyQ');
    input.press('KeyQ');
    input.update(20);
    expect(input.state.hands.left.closed).toBe(false);
    expect(input.state.hands.left.curl).toBeCloseTo(1.8);
    expect(events.map((e) => e.type)).toEqual(['FistClosed', 'FistOpened']);
    expect(input.state.hands.right.present && input.state.hands.right.known).toBe(true);
  });

  it('closes the selected hand while the mouse button is held', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyA');
    input.setButton(true);
    input.update(10);
    expect(input.state.hands.left.closed).toBe(true);
    expect(input.state.hands.right.closed).toBe(false);
    input.setButton(false);
    input.update(20);
    expect(input.state.hands.left.closed).toBe(false);
    expect(events).toEqual([
      { type: 'FistClosed', t: 10, hand: 'left' },
      { type: 'FistOpened', t: 20, hand: 'left' },
    ]);
  });

  it('moves only the selected hand cursor', () => {
    const { input } = make();
    input.update(0);
    const rightBefore = { ...input.state.hands.right };
    input.press('KeyA');
    input.moveTo(0.2, 0.3);
    input.update(10);
    expect(input.state.hands.left.x).toBeCloseTo(0.2);
    expect(input.state.hands.left.y).toBeCloseTo(0.3);
    expect(input.state.hands.right.x).toBe(rightBefore.x);
    input.press('KeyD');
    input.moveTo(0.8, 0.6);
    input.update(20);
    expect(input.state.hands.right.x).toBeCloseTo(0.8);
    expect(input.state.hands.left.x).toBeCloseTo(0.2);
  });

  it('mirrors the neutral lateral for the left hand', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyA');
    input.moveTo(0.5, 0.5);
    input.press('KeyT');
    input.update(100);
    input.release('KeyT');
    input.update(200);
    const rel = of(events, 'ThrowReleased')[0];
    expect(rel.hand).toBe('left');
    expect(rel.lateral).toBeCloseTo(-debugInputConfig.neutralLateral);
  });

  it('selecting a hand does not move it; it follows once the mouse moves', () => {
    const { input } = make();
    input.update(0);
    input.moveTo(0.8, 0.3);
    input.update(10); // right hand follows
    const leftBefore = { x: input.state.hands.left.x, y: input.state.hands.left.y };
    input.press('KeyA');
    input.update(20);
    expect(input.state.hands.left.x).toBe(leftBefore.x);
    expect(input.state.hands.left.y).toBe(leftBefore.y);
    input.moveTo(0.3, 0.4);
    input.update(30);
    expect(input.state.hands.left.x).toBeCloseTo(0.3);
    expect(input.state.hands.right.x).toBeCloseTo(0.8);
  });

  it('synthesises wrists that land on the cursor for each hand', () => {
    for (const [key, idx, side] of [
      ['KeyA', PoseIndex.LEFT_WRIST, 'left'],
      ['KeyD', PoseIndex.RIGHT_WRIST, 'right'],
    ] as const) {
      for (const [mx, my] of [
        [0.5, 0.4],
        [0.45, 0.35],
        [0.56, 0.38],
      ] as const) {
        const { input } = make();
        input.update(0);
        input.press(key);
        input.moveTo(mx, my);
        input.update(16);
        input.update(32);
        const o = idx * POSE_STRIDE;
        expect(Math.abs(input.state.pose[o]! - mx)).toBeLessThan(0.02);
        expect(Math.abs(input.state.pose[o + 1]! - my)).toBeLessThan(0.02);
        expect(input.state.hands[side].x).toBeCloseTo(mx);
      }
    }
  });

  it('raises one arm or both', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyA');
    input.press('KeyU');
    input.update(10);
    input.release('KeyU');
    input.update(20);
    input.press('KeyI');
    input.update(30);
    input.release('KeyI');
    input.update(40);
    expect(events).toEqual([
      { type: 'ArmRaised', t: 10, hand: 'left', both: false },
      { type: 'ArmLowered', t: 20, hand: 'left' },
      { type: 'ArmRaised', t: 30, hand: 'left', both: true },
      { type: 'ArmRaised', t: 30, hand: 'right', both: true },
      { type: 'ArmLowered', t: 40, hand: 'left' },
      { type: 'ArmLowered', t: 40, hand: 'right' },
    ]);
  });

  function throwFor(holdMs: number, key = 'KeyT', extra?: string, mx = 0.5, my = 0.5) {
    const { input, events } = make();
    input.update(0);
    input.moveTo(mx, my);
    input.press(key);
    input.update(100);
    if (extra) input.press(extra);
    input.release(key);
    input.update(100 + holdMs);
    return { events, released: of(events, 'ThrowReleased')[0] };
  }

  it('emits a windup then a release whose speed grows with charge and clamps', () => {
    const tap = throwFor(0);
    expect(tap.events[0]).toMatchObject({ type: 'ThrowWindup', hand: 'right' });
    const c = debugInputConfig;
    expect(tap.released.speed).toBeCloseTo(c.throwMinSpeed);
    const half = throwFor(c.throwChargeMs / 2).released.speed;
    expect(half).toBeCloseTo((c.throwMinSpeed + c.throwMaxSpeed) / 2);
    expect(throwFor(c.throwChargeMs * 5).released.speed).toBeCloseTo(c.throwMaxSpeed);
  });

  it('computes lateral, loft, velocity and style', () => {
    const over = throwFor(0, 'KeyT', undefined, 0.75, 0.5).released;
    expect(over.lateral).toBeCloseTo(debugInputConfig.neutralLateral + 1);
    expect(over.loft).toBeCloseTo(0.6);
    expect(over.style).toBe('overarm');
    expect(over.vy).toBeCloseTo(over.speed * Math.sin(0.6));
    expect(over.vx).toBeCloseTo(over.speed * Math.cos(0.6));
    const centre = throwFor(0, 'KeyT', undefined, 0.5, 0.5).released;
    expect(centre.lateral).toBeCloseTo(debugInputConfig.neutralLateral);
    expect(centre.vx).toBeGreaterThan(0); // the centre is a straight throw, not a dead-centre one
    const high = throwFor(0, 'KeyT', undefined, 0.5, 0).released;
    expect(high.loft).toBeCloseTo(1.4);
    const under = throwFor(0, 'KeyB', undefined, 0.25, 0.1).released;
    expect(under.style).toBe('underarm');
    expect(under.loft).toBeCloseTo(0.3);
    expect(under.vx).toBeLessThan(0);
  });

  it('applies curvature from Z and C', () => {
    expect(throwFor(0, 'KeyT', 'KeyZ').released.curvature).toBeCloseTo(-0.6);
    expect(throwFor(0, 'KeyT', 'KeyC').released.curvature).toBeCloseTo(0.6);
    expect(throwFor(0).released.curvature).toBe(0);
  });

  it('swing emits started, then the peak after the delay in game time', () => {
    const { input, events } = make();
    input.update(0);
    input.moveTo(0.5, 0.25);
    input.press('KeyS');
    input.update(1000);
    expect(events).toEqual([
      { type: 'SwingStarted', t: 1000, speed: 8, height: 0.5, direction: 1 },
    ]);
    input.update(1089);
    expect(events).toHaveLength(1);
    input.update(1100);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'SwingPeak', t: 1100, speed: 8, height: 0.5 });
    expect((events[1] as { plane: number }).plane).toBeCloseTo(0.2);
  });

  it('swing direction follows the selected hand and Shift is faster', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyA');
    input.press('KeyS', { shift: true });
    input.update(10);
    expect(events[0]).toMatchObject({ type: 'SwingStarted', direction: -1, speed: 11 });
  });

  it('alternates step sides and reports cadence at a steady rate, then decays to zero', () => {
    const { input, events } = make();
    input.update(0);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      t += 300;
      input.release('KeyR');
      input.press('KeyR');
      input.update(t);
    }
    const steps = of(events, 'Step');
    expect(steps.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
    expect(steps[0].amplitude).toBe(0.4);
    expect(input.state.cadence.stepsPerSecond).toBeCloseTo(1000 / 300, 5);
    expect(input.state.cadence.amplitude).toBe(0.4);
    input.update(t + 400);
    expect(input.state.cadence.stepsPerSecond).toBeCloseTo((1000 / 300) * 0.8, 5);
    input.update(t + 800);
    expect(input.state.cadence.stepsPerSecond).toBe(0);
    expect(input.state.cadence.amplitude).toBe(0);
  });

  it('auto-runs at the configured rate, faster with Shift', () => {
    const run = (shift: boolean) => {
      const { input, events } = make();
      input.update(0);
      input.press('ArrowUp', { shift });
      for (let t = 0; t <= 2000; t += 16) input.update(t);
      return { count: of(events, 'Step').length, input };
    };
    const normal = run(false);
    expect(normal.count).toBeGreaterThanOrEqual(6);
    expect(normal.count).toBeLessThanOrEqual(8);
    expect(normal.input.state.cadence.stepsPerSecond).toBeGreaterThan(2.8);
    expect(normal.input.state.cadence.stepsPerSecond).toBeLessThan(3.6);
    const fast = run(true);
    expect(fast.count).toBeGreaterThanOrEqual(9);
    expect(fast.count).toBeLessThanOrEqual(11);
  });

  it('moves laterally and leans at the configured rates with clamps and recentre', () => {
    const { input } = make();
    input.update(0);
    input.press('ArrowRight');
    input.update(500);
    expect(input.state.lateral).toBeCloseTo(0.6);
    input.update(5000);
    expect(input.state.lateral).toBeCloseTo(2.0);
    input.release('ArrowRight');
    input.press('ArrowLeft', { shift: true });
    input.update(5500);
    expect(input.state.lean).toBeCloseTo(-0.4);
    input.update(9000);
    expect(input.state.lean).toBeCloseTo(-0.45);
    expect(input.state.lateral).toBeCloseTo(2.0);
    input.release('ArrowLeft');
    input.press('ArrowDown');
    input.update(9010);
    expect(input.state.lateral).toBe(0);
    expect(input.state.lean).toBe(0);
  });

  it('squat holds rise, jump runs a rise and fall, punch emits', () => {
    const { input, events } = make();
    input.update(0);
    input.press('KeyK');
    input.update(10);
    expect(input.state.rise).toBeCloseTo(-0.5);
    input.release('KeyK');
    input.update(20);
    expect(input.state.rise).toBe(0);
    input.press('KeyJ');
    input.update(100);
    input.update(300);
    expect(input.state.rise).toBeCloseTo(0.35, 2);
    input.update(600);
    expect(input.state.rise).toBe(0);
    input.press('KeyP');
    input.update(610);
    expect(events).toEqual([
      { type: 'Squat', t: 10, depth: 0.5 },
      { type: 'Jump', t: 100, height: 0.35 },
      { type: 'Punch', t: 610, hand: 'right', speed: 6 },
    ]);
  });
});

describe('DebugInput DOM handling', () => {
  it('maps mouse and keys from real DOM events and ignores auto-repeat', () => {
    const { input, events } = make(window);
    input.update(0);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 100 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); // held, no keyup
    input.update(10);
    expect(input.state.hands.right.x).toBeCloseTo(0.25);
    expect(input.state.hands.right.y).toBeCloseTo(0.2);
    expect(events.map((e) => e.type)).toEqual(['FistClosed', 'Punch']);
    input.stop();
  });

  it('ignores keys typed into inputs', () => {
    const { input, events } = make(window);
    const field = document.createElement('input');
    document.body.appendChild(field);
    input.update(0);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));
    input.update(10);
    expect(events).toHaveLength(0);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));
    input.update(20);
    expect(events).toHaveLength(1);
    input.stop();
    field.remove();
  });

  it('stop removes listeners', () => {
    const { input, events } = make(window);
    input.update(0);
    input.stop();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
    input.press('KeyP');
    input.update(10);
    expect(events).toHaveLength(0);
  });
});

describe('DebugInput pose synthesis', () => {
  it('writes a finite pose that follows the cursor, and keeps the previous pose', () => {
    const { input } = make();
    input.update(0);
    const wristX = (pose: Float32Array) => pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE];
    expect(input.state.hasPose).toBe(true);
    expect(input.state.tracking).toBe(true);
    expect(input.state.problem).toBe('none');
    input.moveTo(0.5, 0.2);
    input.update(16);
    const before = Float32Array.from(input.state.pose);
    input.moveTo(0.62, 0.2);
    input.update(32);
    expect(input.state.posePrev).toEqual(before);
    expect(wristX(input.state.pose)).toBeGreaterThan(wristX(before));
    expect(input.state.pose.every(Number.isFinite)).toBe(true);
    expect(input.state.t).toBe(32);
    expect(input.state.tPrev).toBe(16);
    expect(input.state.shoulderWidth).toBeGreaterThan(0);
    expect(input.state.hands.right.vx).toBeGreaterThan(0);
  });

  it('lateral movement shifts the body', () => {
    const { input } = make();
    input.update(0);
    const nose = () => input.state.pose[PoseIndex.NOSE * POSE_STRIDE];
    const x0 = nose();
    input.press('ArrowRight');
    input.update(500);
    expect(nose()).toBeGreaterThan(x0);
  });

  it('gives hasPose false and leaves the pose untouched for hands-only needs', async () => {
    const { input } = make();
    await input.start({ pose: false, handCrops: false, fullFrameHands: true });
    input.moveTo(0.3, 0.4);
    input.update(16);
    expect(input.state.hasPose).toBe(false);
    expect(input.state.pose.every((v) => v === 0)).toBe(true);
    expect(input.state.hands.left.present && input.state.hands.right.present).toBe(true);
    expect(input.state.hands.right.x).toBeCloseTo(0.3);
    expect(input.source).toBeNull();
  });
});

describe('DEBUG_KEYS', () => {
  it('lists every binding', () => {
    const all = DEBUG_KEYS.map((k) => k.keys).join(' | ');
    for (const needle of [
      'Mouse',
      'A / D',
      'Left button',
      'Q / E',
      'U',
      'I',
      'T',
      'B',
      'Z / C',
      'S',
      'R',
      'Up arrow',
      'Left / Right arrows',
      'Shift + Left / Right',
      'Down arrow',
      'P',
      'K',
      'J',
    ]) {
      expect(all).toContain(needle);
    }
    expect(DEBUG_KEYS.every((k) => k.action.length > 0)).toBe(true);
  });
});

describe('DebugInput update', () => {
  it('keeps both hands present with finite velocities across many updates', () => {
    const { input } = make();
    for (let i = 0; i <= 120; i++) input.update(i * 16);
    for (const side of ['left', 'right'] as const) {
      const h = input.state.hands[side];
      expect(h.present).toBe(true);
      expect(Number.isFinite(h.vx)).toBe(true);
      expect(Number.isFinite(h.vy)).toBe(true);
    }
  });
});
