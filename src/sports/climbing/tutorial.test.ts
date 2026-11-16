import { describe, expect, it, vi } from 'vitest';
import type { Coach } from '../../core/sport';
import { applyEase } from '../../tracking/synthetic/script';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { createClimbBot } from './bot';
import type { TutorialProbe } from './bot';
import { climbingConfig } from './config';
import { Layout, mulberry32 } from './layout';
import { createClimbState, createStepInput, heightOf, step } from './rules';
import { createClimbTutorial, keepSafe } from './tutorial';
import type { ClimbTutorial, HandView } from './tutorial';

type Controls = Record<string, number>;

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string) => {
      shown.push(text);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn(),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, pressSkip: () => skip?.() };
}

interface Rig {
  tutorial: ClimbTutorial;
  state: ReturnType<typeof createClimbState>;
  layout: Layout;
  hands: { left: HandView; right: HandView };
  probe: TutorialProbe;
  finished: ReturnType<typeof vi.fn>;
  coach: ReturnType<typeof fakeCoach>;
}

/** Steps the tutorial every 50 ms of game time. */
function clock(t: Rig): (ms: number) => void {
  let now = 0;
  return (ms: number): void => {
    for (const end = now + ms; now < end;) {
      now += 50;
      t.tutorial.update(now);
    }
  };
}

function rig(mouse: { dragging: boolean; aimable: boolean } | null = null, seed = 1): Rig {
  const cfg = { ...climbingConfig };
  const layout = new Layout(mulberry32(seed), cfg);
  const state = createClimbState(cfg, Number.POSITIVE_INFINITY);
  const hands = {
    left: { present: true, closed: false },
    right: { present: true, closed: false },
  };
  const probe: TutorialProbe = { rest: false };
  const finished = vi.fn();
  const coach = fakeCoach();
  const tutorial = createClimbTutorial({
    cfg,
    state,
    field: layout,
    coach: coach.coach,
    hands: () => hands,
    mouse: mouse === null ? null : { dragging: () => mouse.dragging, aimable: () => mouse.aimable },
    probe,
    onFinished: finished,
  });
  return { tutorial, state, layout, hands, probe, finished, coach };
}

/** Closed loop without a browser: the bot plays, the tutorial watches, the real rules run at 120 Hz. */
function simulate(seed: number, seconds: number) {
  const cfg = { ...climbingConfig };
  const layout = new Layout(mulberry32(seed), cfg);
  const state = createClimbState(cfg, Number.POSITIVE_INFINITY);
  const input = createStepInput();
  const probe: TutorialProbe = { rest: false };
  const bot = createClimbBot(cfg, state, layout, probe);
  const { coach, shown } = fakeCoach();
  let finishedAt = -1;
  let now = 0;
  const tutorial = createClimbTutorial({
    cfg,
    state,
    field: layout,
    coach,
    hands: () => ({
      left: { present: true, closed: input.left.closed },
      right: { present: true, closed: input.right.closed },
    }),
    mouse: null,
    probe,
    onFinished: () => {
      finishedAt = now;
    },
  });
  const controls: Controls = {
    leftHandX: 0.35,
    leftHandY: 0.55,
    rightHandX: 0.65,
    rightHandY: 0.55,
    leftFist: 0,
    rightFist: 0,
  };
  const queue: ScriptStep[] = [];
  let cur: { step: ScriptStep; t: number; from: Controls } | null = null;
  const raw = { left: false, right: false };
  const since = { left: 0, right: 0 };
  const dt = 1 / 120;
  let minStamina = 1;
  let fell = false;
  const enqueue = (s: ScriptStep[]): void => {
    queue.push(...s);
  };
  for (let i = 0; i < seconds * 120 && finishedAt < 0; i++) {
    now += dt * 1000;
    if (cur === null && queue.length === 0) bot.next(enqueue, now);
    if (cur === null && queue.length > 0) {
      const s = queue.shift()!;
      const from: Controls = {};
      for (const k of Object.keys(s.to ?? {})) from[k] = controls[k] ?? 0;
      cur = { step: s, t: 0, from };
    }
    if (cur !== null) {
      cur.t += dt * 1000;
      const p = Math.min(1, cur.t / cur.step.dur);
      const e = applyEase(cur.step.ease ?? 'smooth', p);
      for (const [k, v] of Object.entries(cur.step.to ?? {})) {
        if (k in controls) controls[k] = cur.from[k]! + (v - cur.from[k]!) * e;
      }
      if (p >= 1) cur = null;
    }
    for (const side of ['left', 'right'] as const) {
      const fist = controls[`${side}Fist`]! > 0.5;
      if (fist !== raw[side]) {
        raw[side] = fist;
        since[side] = now;
      }
      if (now - since[side] >= 100) input[side].closed = raw[side];
      input[side].x = controls[`${side}HandX`]!;
      input[side].y = controls[`${side}HandY`]!;
    }
    layout.ensure(state.y + 6);
    step(state, cfg, layout, input, dt);
    keepSafe(state, cfg);
    minStamina = Math.min(minStamina, state.stamina);
    if (state.status === 'fell') fell = true;
    // The sport's frame runs at about 60 Hz.
    if (i % 2 === 0) tutorial.update(now);
  }
  return { finishedAt, shown, minStamina, fell, steps: tutorial.stepCount, cfg, state };
}

describe('climbing tutorial (camera)', () => {
  it('the bot completes every step, on several walls, with no fall', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = simulate(seed, 90);
      expect(r.finishedAt, `seed ${seed}`).toBeGreaterThan(0);
      expect(r.shown.length, `seed ${seed}`).toBe(7);
      expect(r.fell).toBe(false);
      expect(r.minStamina).toBeGreaterThanOrEqual(r.cfg.tutorialStaminaFloor - 1e-9);
      expect(heightOf(r.state, r.cfg)).toBeGreaterThanOrEqual(r.cfg.tutorialTopM);
    }
  });

  it('shows the steps in the planned order, one short line each', () => {
    const r = simulate(1, 90);
    expect(r.shown).toEqual([
      'Hold both hands up so I can see them',
      'Reach for a hold and make a fist to grab it',
      'Now grab a hold with your other hand',
      'Pull your fists down to climb',
      'Open one hand, reach higher, grab again',
      'Hang on with both hands and hold still',
      'Climb to the flag',
    ]);
    for (const line of r.shown) expect(line.length).toBeLessThan(50);
  });

  it('step 1 waits for both hands and says which one is missing', () => {
    const t = rig();
    t.hands.left.present = false;
    t.hands.right.present = false;
    t.tutorial.update(0);
    t.tutorial.update(2600);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith("I can't see your hands");
    t.hands.right.present = true;
    t.tutorial.update(2700);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith("I can't see your left hand");
    t.hands.left.present = true;
    t.hands.right.present = false;
    t.tutorial.update(2800);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith("I can't see your right hand");
    expect(t.tutorial.step).toBe(0);
    t.hands.right.present = true;
    t.tutorial.update(2900);
    t.tutorial.update(3600);
    expect(t.coach.coach.confirm).toHaveBeenCalledTimes(1);
  });

  it('step 2 hints at the fist, then at the distance to a hold, only after a pause', () => {
    const t = rig();
    const run = clock(t);
    run(3000); // step 1 done, praise, step 2 entered
    const fb = t.coach.coach.setFeedback;
    expect(t.tutorial.step).toBe(1);
    expect(fb).toHaveBeenLastCalledWith(null);
    run(900);
    expect(fb).toHaveBeenLastCalledWith(null);
    run(1500);
    expect(fb).toHaveBeenLastCalledWith('Close your fist on a hold');
    t.hands.left.closed = true;
    run(100);
    expect(fb).toHaveBeenLastCalledWith('Move closer to a hold');
  });

  it('a skipped step moves on, and skipping the last one finishes', () => {
    const t = rig();
    t.tutorial.update(0);
    for (let i = 0; i < 7; i++) {
      t.coach.pressSkip();
      t.tutorial.update(100 + i * 16);
      t.tutorial.update(110 + i * 16);
    }
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.coach.pressSkip();
    t.tutorial.update(5000);
    expect(t.finished).toHaveBeenCalledTimes(1);
  });

  it('the rest step turns on the bot probe and the stamina bar, and clears them after', () => {
    const t = rig();
    expect(t.tutorial.showStamina).toBe(false);
    for (let i = 0; i < 5; i++) {
      t.coach.pressSkip();
      t.tutorial.update(i * 40);
      t.tutorial.update(i * 40 + 16);
    }
    expect(t.tutorial.step).toBe(5);
    expect(t.probe.rest).toBe(true);
    expect(t.tutorial.showStamina).toBe(true);
    t.coach.pressSkip();
    t.tutorial.update(1000);
    t.tutorial.update(1016);
    expect(t.tutorial.step).toBe(6);
    expect(t.probe.rest).toBe(false);
    expect(t.tutorial.showStamina).toBe(true);
    t.tutorial.dispose();
    expect(t.coach.coach.hide).toHaveBeenCalled();
  });
});

describe('climbing tutorial (mouse)', () => {
  it('has the six mouse steps and names the mouse actions', () => {
    const ptr = { dragging: false, aimable: false };
    const t = rig(ptr);
    expect(t.tutorial.stepCount).toBe(6);
    t.tutorial.update(0);
    expect(t.coach.shown[0]).toBe('Press and hold a hold to grab it');
    t.tutorial.update(2700);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Move the pointer onto a hold');
    ptr.aimable = true;
    t.tutorial.update(2800);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Keep the button down');
  });

  it('counts a grab, then a pull, then the other hand, then a higher grab', () => {
    const t = rig({ dragging: false, aimable: true });
    const run = clock(t);
    const { state, layout } = t;
    run(100);
    expect(t.tutorial.step).toBe(0);
    // Grab a low hold with the right hand.
    const low = layout.findNearest(layout.holdX(0), layout.holdY(0), -1, -1);
    state.right.holding = true;
    state.right.hold = low;
    state.grabs = 1;
    state.grabSeq = 1;
    state.lastGrabSide = 1;
    run(3000);
    expect(t.tutorial.step).toBe(1);
    // Pull: the climber rises.
    state.y += 0.8;
    run(3000);
    expect(t.tutorial.step).toBe(2);
    // The left hand takes a hold.
    state.left.holding = true;
    state.left.hold = low + 1;
    state.grabs = 2;
    state.grabSeq = 2;
    state.lastGrabSide = 0;
    run(3000);
    expect(t.tutorial.step).toBe(3);
    // A higher hold with the right hand.
    let higher = low + 1;
    while (layout.holdY(higher) < layout.holdY(state.left.hold) + 0.5) higher++;
    state.right.hold = higher;
    state.grabs = 3;
    state.grabSeq = 3;
    state.lastGrabSide = 1;
    run(3000);
    expect(t.tutorial.step).toBe(4);
  });

  it('the hang step needs a grip with the button up, for a while', () => {
    const ptr = { dragging: true, aimable: true };
    const t = rig(ptr);
    const run = clock(t);
    for (let i = 0; i < 4; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(4);
    t.state.left.holding = true;
    t.state.left.hold = 3;
    run(4000); // dragging: it does not count
    expect(t.tutorial.step).toBe(4);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Let go of the button and hang');
    ptr.dragging = false;
    run(1000);
    expect(t.tutorial.step).toBe(4);
    run(3000);
    expect(t.tutorial.step).toBe(5);
  });
});

describe('keepSafe', () => {
  it('lifts the stamina to the floor and clears the slip timer', () => {
    const cfg = { ...climbingConfig };
    const state = createClimbState(cfg, Number.POSITIVE_INFINITY);
    state.stamina = 0.01;
    state.slipMs = 300;
    keepSafe(state, cfg);
    expect(state.stamina).toBe(cfg.tutorialStaminaFloor);
    expect(state.slipMs).toBe(0);
    state.stamina = 0.9;
    keepSafe(state, cfg);
    expect(state.stamina).toBe(0.9);
  });

  it('a climber with nothing to hold never falls in the tutorial', () => {
    const cfg = { ...climbingConfig };
    const layout = new Layout(mulberry32(1), cfg);
    const state = createClimbState(cfg, Number.POSITIVE_INFINITY);
    const input = createStepInput();
    state.status = 'climbing';
    state.y += 3; // off the ground, holding nothing
    for (let i = 0; i < 1200; i++) {
      step(state, cfg, layout, input, 1 / 120);
      keepSafe(state, cfg);
    }
    expect(state.status).toBe('climbing');
  });

  it('has no timer: the round never times out', () => {
    const cfg = { ...climbingConfig };
    const layout = new Layout(mulberry32(1), cfg);
    const state = createClimbState(cfg, Number.POSITIVE_INFINITY);
    const input = createStepInput();
    state.status = 'climbing';
    state.left.holding = false;
    state.stamina = 1;
    state.y += 3;
    for (let i = 0; i < 120 * 200; i++) {
      step(state, cfg, layout, input, 1 / 120);
      keepSafe(state, cfg);
    }
    expect(state.status).not.toBe('timeout');
  });
});
