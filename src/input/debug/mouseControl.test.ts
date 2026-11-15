// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputProvider } from '../types';
import { DebugInput, debugInputConfig } from './DebugInput';
import { asMouseControl } from './mouseControl';

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

function mouse(el: Element, type: 'mousedown' | 'mouseup', button = 0): void {
  el.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
}

describe('DebugInput pointer state and the press filter', () => {
  it('tracks down, presses, releases and held time (game time)', () => {
    const { input } = make();
    input.update(0);
    expect(input.pointerDown).toBe(false);
    expect(input.pointerHeldMs).toBe(0);
    input.setButton(true);
    input.update(100);
    expect(input.pointerDown).toBe(true);
    expect(input.pointerPresses).toBe(1);
    expect(input.pointerHeldMs).toBe(0);
    input.update(350);
    expect(input.pointerHeldMs).toBe(250);
    input.setButton(true); // a second down while down is not a new press
    input.update(400);
    expect(input.pointerPresses).toBe(1);
    expect(input.pointerHeldMs).toBe(300);
    input.setButton(false);
    input.update(450);
    expect(input.pointerDown).toBe(false);
    expect(input.pointerReleases).toBe(1);
    expect(input.pointerHeldMs).toBe(0);
    input.setButton(false);
    input.update(460);
    expect(input.pointerReleases).toBe(1);
  });

  it('counts presses on the game, not on buttons, links, inputs or data-ui', () => {
    const { input } = make(window);
    const host = document.createElement('div');
    const button = document.createElement('button');
    const inner = document.createElement('span');
    button.append(inner);
    const link = document.createElement('a');
    const field = document.createElement('input');
    const panel = document.createElement('div');
    panel.setAttribute('data-ui', '');
    const panelChild = document.createElement('p');
    panel.append(panelChild);
    const canvas = document.createElement('canvas');
    host.append(button, link, field, panel, canvas);
    document.body.append(host);
    input.update(0);
    for (const el of [inner, button, link, field, panel, panelChild]) {
      mouse(el, 'mousedown');
      mouse(el, 'mouseup');
    }
    input.update(10);
    expect(input.pointerPresses).toBe(0);
    expect(input.pointerReleases).toBe(0);
    expect(input.state.hands.right.closed).toBe(false);
    mouse(canvas, 'mousedown');
    input.update(20);
    expect(input.pointerDown).toBe(true);
    expect(input.pointerPresses).toBe(1);
    mouse(canvas, 'mouseup');
    input.update(30);
    expect(input.pointerReleases).toBe(1);
    input.stop();
    host.remove();
  });

  it('a release anywhere ends a counted press; an uncounted press or stray release counts nothing', () => {
    const { input } = make(window);
    const button = document.createElement('button');
    const canvas = document.createElement('canvas');
    document.body.append(button, canvas);
    input.update(0);
    mouse(button, 'mouseup');
    input.update(5);
    expect(input.pointerReleases).toBe(0);
    mouse(canvas, 'mousedown');
    mouse(button, 'mouseup');
    input.update(10);
    expect(input.pointerPresses).toBe(1);
    expect(input.pointerReleases).toBe(1);
    expect(input.pointerDown).toBe(false);
    mouse(button, 'mousedown');
    mouse(canvas, 'mouseup');
    input.update(20);
    expect(input.pointerPresses).toBe(1);
    expect(input.pointerReleases).toBe(1);
    mouse(canvas, 'mousedown', 2); // only the left button
    input.update(30);
    expect(input.pointerPresses).toBe(1);
    input.stop();
    button.remove();
    canvas.remove();
  });

  it('window blur lets go of a counted press', () => {
    const { input } = make(window);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    input.update(0);
    mouse(canvas, 'mousedown');
    input.update(10);
    expect(input.pointerDown).toBe(true);
    window.dispatchEvent(new Event('blur'));
    input.update(20);
    expect(input.pointerDown).toBe(false);
    expect(input.pointerReleases).toBe(1);
    input.stop();
    canvas.remove();
  });
});

describe('DebugInput MouseControl', () => {
  it('asMouseControl finds the provider and rejects others', () => {
    const { input } = make();
    expect(asMouseControl(input)).toBe(input);
    expect(asMouseControl(null)).toBeNull();
    expect(asMouseControl({} as InputProvider)).toBeNull();
  });

  it('manual mode: the button has no built-in effect, presses still count', () => {
    const { input, events } = make();
    input.setManualMode(true);
    input.update(0);
    input.setButton(true);
    input.update(10);
    input.setButton(false);
    input.update(20);
    expect(input.pointerPresses).toBe(1);
    expect(input.pointerReleases).toBe(1);
    expect(input.state.hands.right.closed).toBe(false);
    expect(of(events, 'FistClosed')).toHaveLength(0);
  });

  it('manual mode on lets go of a fist the button was holding', () => {
    const { input, events } = make();
    input.update(0);
    input.setButton(true);
    input.update(10);
    expect(input.state.hands.right.closed).toBe(true);
    input.setManualMode(true);
    expect(input.state.hands.right.closed).toBe(false);
    expect(of(events, 'FistOpened')).toHaveLength(1);
  });

  it('setPointerFollow(false) freezes the hand; setHandTarget places it', () => {
    const { input } = make();
    input.update(0);
    input.moveTo(0.2, 0.3);
    input.update(10);
    expect(input.state.hands.right.x).toBeCloseTo(0.2);
    input.setPointerFollow(false);
    input.moveTo(0.8, 0.9);
    input.update(20);
    expect(input.pointerX).toBeCloseTo(0.8);
    expect(input.state.hands.right.x).toBeCloseTo(0.2);
    input.setHandTarget('right', 0.6, 0.4);
    input.setHandTarget('left', 2, -1);
    input.update(30);
    expect(input.state.hands.right.x).toBeCloseTo(0.6);
    expect(input.state.hands.right.y).toBeCloseTo(0.4);
    expect(input.state.hands.left.x).toBe(1);
    expect(input.state.hands.left.y).toBe(0);
    input.selectHand('left'); // does not jump under the mouse while frozen
    expect(input.state.hands.left.x).toBe(1);
    input.setPointerFollow(true);
    input.moveTo(0.1, 0.1);
    input.update(40);
    expect(input.state.hands.left.x).toBeCloseTo(0.1);
  });

  it('setHandClosed opens and closes either hand with the key events', () => {
    const { input, events } = make();
    input.update(0);
    input.setHandClosed('left', true);
    input.setHandClosed('left', true);
    input.setHandClosed('right', true);
    input.update(10);
    input.setHandClosed('left', false);
    input.update(20);
    expect(input.state.hands.left.closed).toBe(false);
    expect(input.state.hands.right.closed).toBe(true);
    expect(events).toEqual([
      { type: 'FistClosed', t: 10, hand: 'left' },
      { type: 'FistClosed', t: 10, hand: 'right' },
      { type: 'FistOpened', t: 20, hand: 'left' },
    ]);
  });

  it('startWindup then releaseThrow with an explicit power and options', () => {
    const { input, events } = make();
    input.update(0);
    input.startWindup('left', 'underarm');
    input.update(100);
    expect(of(events, 'ThrowWindup')).toEqual([{ type: 'ThrowWindup', t: 100, hand: 'left' }]);
    input.releaseThrow(0.5, { loft: 0.2, lateral: -0.7, curvature: 0.3 });
    input.update(150);
    const [r] = of(events, 'ThrowReleased');
    const c = debugInputConfig;
    expect(r.hand).toBe('left');
    expect(r.style).toBe('underarm');
    expect(r.speed).toBeCloseTo(c.throwMinSpeed + (c.throwMaxSpeed - c.throwMinSpeed) * 0.5);
    expect(r.loft).toBe(0.2);
    expect(r.lateral).toBe(-0.7);
    expect(r.curvature).toBe(0.3);
    expect(r.vx).toBeLessThan(0);
    expect(r.t).toBe(150);
    input.releaseThrow(1); // no windup: no-op
    input.update(200);
    expect(of(events, 'ThrowReleased')).toHaveLength(1);
  });

  it('releaseThrow without power uses the hold time; lateral and loft follow the pointer', () => {
    const { input, events } = make();
    input.update(0);
    input.moveTo(0.5, 0.5);
    input.startWindup();
    input.update(100);
    input.releaseThrow();
    input.update(100 + debugInputConfig.throwChargeMs);
    const [r] = of(events, 'ThrowReleased');
    expect(r.hand).toBe('right');
    expect(r.style).toBe('overarm');
    expect(r.speed).toBeCloseTo(debugInputConfig.throwMaxSpeed);
    expect(r.lateral).toBeCloseTo(debugInputConfig.neutralLateral);
    expect(r.loft).toBeCloseTo(0.6);
    expect(r.curvature).toBe(0);
  });

  it('a second startWindup is ignored, and releaseThrow without a windup does nothing', () => {
    const { input, events } = make();
    input.update(0);
    input.releaseThrow(1);
    input.update(10);
    expect(of(events, 'ThrowReleased')).toHaveLength(0);
    input.startWindup();
    input.startWindup('left');
    input.update(50);
    expect(of(events, 'ThrowWindup')).toHaveLength(1);
    input.releaseThrow(1);
    input.releaseThrow(1);
    input.update(60);
    expect(of(events, 'ThrowReleased')).toHaveLength(1);
    expect(of(events, 'ThrowReleased')[0].hand).toBe('right');
  });

  it('throwNow does windup and release in the same update', () => {
    const { input, events } = make();
    input.update(0);
    input.throwNow(1, { hand: 'left', style: 'overarm', lateral: 0.1, loft: 0.5 });
    input.update(40);
    expect(events.map((e) => e.type)).toEqual(['ThrowWindup', 'ThrowReleased']);
    const [r] = of(events, 'ThrowReleased');
    expect(r.hand).toBe('left');
    expect(r.speed).toBeCloseTo(debugInputConfig.throwMaxSpeed);
    expect(r.t).toBe(40);
  });

  it('swing: default power, full power, explicit height and direction', () => {
    const { input, events } = make();
    input.update(0);
    input.moveTo(0.5, 0.25);
    input.update(1);
    input.swing();
    input.update(10);
    input.swing({ power: 1, height: -0.5, direction: -1 });
    input.update(20);
    input.update(200);
    const started = of(events, 'SwingStarted');
    expect(started[0].speed).toBeCloseTo(debugInputConfig.swingSpeed);
    expect(started[0].height).toBeCloseTo(0.5);
    expect(started[0].direction).toBe(1);
    expect(started[1].speed).toBeCloseTo(debugInputConfig.swingSpeed * 1.375);
    expect(started[1].height).toBeCloseTo(-0.5);
    expect(started[1].direction).toBe(-1);
    const peaks = of(events, 'SwingPeak');
    expect(peaks).toHaveLength(2);
    expect(peaks[1].plane).toBeCloseTo(-0.2);
  });

  it('setRunCadence emits steps at the rate, alternating legs, and 0 stops', () => {
    const { input, events } = make();
    input.update(0);
    input.setRunCadence(4);
    for (let t = 16; t <= 1000; t += 16) input.update(t);
    const steps = of(events, 'Step');
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);
    expect(steps[0].side).toBe('left');
    expect(steps[1].side).toBe('right');
    expect(input.state.cadence.stepsPerSecond).toBeGreaterThan(3);
    expect(input.state.cadence.stepsPerSecond).toBeLessThan(5);
    input.setRunCadence(0);
    const n = steps.length;
    for (let t = 1016; t <= 2200; t += 16) input.update(t);
    expect(of(events, 'Step')).toHaveLength(n);
    expect(input.state.cadence.stepsPerSecond).toBe(0);
  });

  it('setRunCadence changes the rate while running', () => {
    const { input, events } = make();
    input.update(0);
    input.setRunCadence(6);
    for (let t = 16; t <= 1000; t += 16) input.update(t);
    const fast = of(events, 'Step').length;
    expect(fast).toBeGreaterThanOrEqual(5);
    input.setRunCadence(2);
    for (let t = 1016; t <= 2000; t += 16) input.update(t);
    const slow = of(events, 'Step').length - fast;
    expect(slow).toBeLessThanOrEqual(3);
    expect(slow).toBeGreaterThanOrEqual(1);
  });

  it('step emits one alternating step', () => {
    const { input, events } = make();
    input.update(0);
    input.step();
    input.update(10);
    input.step();
    input.update(20);
    expect(of(events, 'Step').map((e) => e.side)).toEqual(['left', 'right']);
  });

  it('setArmsRaised: one arm, switching, both, none', () => {
    const { input, events } = make();
    input.update(0);
    input.setArmsRaised('left');
    input.update(10);
    input.setArmsRaised('right');
    input.update(20);
    input.setArmsRaised('both');
    input.update(30);
    input.setArmsRaised('none');
    input.update(40);
    expect(events.map((e) => `${e.type}:${'hand' in e ? e.hand : ''}`)).toEqual([
      'ArmRaised:left',
      'ArmLowered:left',
      'ArmRaised:right',
      'ArmLowered:right',
      'ArmRaised:left',
      'ArmRaised:right',
      'ArmLowered:left',
      'ArmLowered:right',
    ]);
    input.setArmsRaised('none'); // already down: nothing
    input.update(50);
    expect(events).toHaveLength(8);
  });

  it('punch defaults to the selected hand', () => {
    const { input, events } = make();
    input.update(0);
    input.punch();
    input.punch('left');
    input.update(10);
    expect(of(events, 'Punch').map((e) => e.hand)).toEqual(['right', 'left']);
    expect(input.state.arms.left.speed).toBeGreaterThan(0);
  });

  it('squat and jump raise Squat and Jump and move the rise', () => {
    const { input, events } = make();
    input.update(0);
    input.setSquat(true);
    input.update(10);
    input.setSquat(true); // already squatting: no second event
    input.update(20);
    expect(of(events, 'Squat')).toHaveLength(1);
    expect(input.state.rise).toBeLessThan(0);
    input.setSquat(false);
    input.update(30);
    expect(input.state.rise).toBe(0);
    input.jump();
    input.update(40);
    input.update(240);
    expect(of(events, 'Jump')).toHaveLength(1);
    expect(input.state.rise).toBeGreaterThan(0);
  });

  it('setLateral and setLean clamp; recentre zeroes both', () => {
    const { input } = make();
    input.update(0);
    input.setLateral(0.5);
    input.setLean(0.2);
    input.update(10);
    expect(input.state.lateral).toBe(0.5);
    expect(input.state.lean).toBe(0.2);
    input.setLateral(99);
    input.setLean(-99);
    input.update(20);
    expect(input.state.lateral).toBe(debugInputConfig.maxLateral);
    expect(input.state.lean).toBe(-debugInputConfig.maxLean);
    input.recentre();
    input.update(30);
    expect(input.state.lateral).toBe(0);
    expect(input.state.lean).toBe(0);
  });

  it('actions are queued until update, and stop drops them', () => {
    const { input, events } = make();
    input.update(0);
    input.punch();
    input.jump();
    expect(events).toHaveLength(0);
    input.stop();
    input.update(10);
    input.punch();
    expect(events).toHaveLength(0);
  });
});
